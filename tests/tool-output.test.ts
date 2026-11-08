/**
 * Tool-output containment tests: bounded inline output, spill retrieval,
 * id validation (path traversal), retention pruning and env clamps.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-tool-output-test-"));

import {
  boundToolOutput,
  formatSpillNotice,
  getToolOutputLimits,
  isValidToolOutputId,
  pruneToolOutputs,
  readToolOutput,
  spillToolOutput,
  toolOutputDir,
} from "@/lib/pi/tool-output";

const thread = (name: string) => `toolout_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

describe("tool output limits", () => {
  it("defaults are bounded and env values are clamped", () => {
    const defaults = getToolOutputLimits();
    assert.ok(defaults.inlineChars >= 1_000);
    assert.ok(defaults.maxChars >= defaults.inlineChars);
    assert.ok(defaults.readChars > 0);

    const saved = {
      inline: process.env.QUBE_TOOL_OUTPUT_INLINE_CHARS,
      max: process.env.QUBE_TOOL_OUTPUT_MAX_CHARS,
      read: process.env.QUBE_TOOL_OUTPUT_READ_CHARS,
    };
    process.env.QUBE_TOOL_OUTPUT_INLINE_CHARS = "1";
    process.env.QUBE_TOOL_OUTPUT_MAX_CHARS = "99999999";
    process.env.QUBE_TOOL_OUTPUT_READ_CHARS = "-5";
    try {
      const limits = getToolOutputLimits();
      assert.equal(limits.inlineChars, 1_000);
      assert.equal(limits.maxChars, 500_000);
      assert.equal(limits.readChars, 1_000);
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore("QUBE_TOOL_OUTPUT_INLINE_CHARS", saved.inline);
      restore("QUBE_TOOL_OUTPUT_MAX_CHARS", saved.max);
      restore("QUBE_TOOL_OUTPUT_READ_CHARS", saved.read);
    }
  });
});

describe("boundToolOutput", () => {
  it("returns small outputs unchanged without a spill", async () => {
    const t = thread("small");
    const out = await boundToolOutput(t, "read_file", "hello");
    assert.equal(out.text, "hello");
    assert.equal(out.spilled, undefined);
    assert.equal(out.shownChars, 5);
  });

  it("spills oversized output, keeps a bounded inline slice and points at the id", async () => {
    const t = thread("big");
    const text = `${"A".repeat(5_000)}TAIL-${"B".repeat(20_000)}`;
    const out = await boundToolOutput(t, "run_command", text, { inlineChars: 1_000 });
    assert.ok(out.spilled);
    assert.ok(out.text.length < text.length);
    assert.ok(out.text.includes(`id="${out.spilled!.id}"`));
    assert.ok(out.text.includes("read_tool_output"));
    assert.equal(out.originalChars, text.length);

    const first = await readToolOutput(t, out.spilled!.id, { maxChars: 4_000 });
    assert.equal(first.offset, 0);
    assert.ok(first.content.length <= 4_000);
    assert.ok(first.nextOffset !== null);

    const second = await readToolOutput(t, out.spilled!.id, { offset: first.nextOffset!, maxChars: 4_000 });
    assert.equal(second.offset, first.nextOffset);
    assert.ok(second.content.length > 0);
  });

  it("can keep the tail instead of the head", async () => {
    const t = thread("tail");
    const out = await boundToolOutput(t, "run_command", `HEAD-${"x".repeat(3000)}-END`, {
      inlineChars: 500,
      strategy: "tail",
    });
    assert.ok(out.text.includes("-END"));
    assert.ok(!out.text.startsWith("HEAD-"));
    assert.ok(out.text.includes("[head omitted]"));
  });

  it("preserves a full spill and redacts secrets before writing", async () => {
    const t = thread("redact");
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const spill = await spillToolOutput(t, "run_command", `before ${secret} after`);
    const read = await readToolOutput(t, spill.id, { maxChars: 10_000 });
    assert.ok(read.content.includes("before"));
    assert.ok(!read.content.includes(secret));
  });
});

describe("readToolOutput validation", () => {
  it("rejects malformed and traversal ids", async () => {
    const t = thread("ids");
    for (const id of ["", "../etc/passwd", "..%2fsecret", "a/b", "abc", "x".repeat(200)]) {
      assert.equal(isValidToolOutputId(id), false, id);
      await assert.rejects(() => readToolOutput(t, id), /Invalid tool output id/i);
    }
    assert.equal(isValidToolOutputId("abc12345"), true);
  });

  it("returns EOF past the end instead of throwing", async () => {
    const t = thread("eof");
    const spill = await spillToolOutput(t, "tool", "short output");
    const res = await readToolOutput(t, spill.id, { offset: 10_000 });
    assert.equal(res.eof, true);
    assert.equal(res.content, "");
    assert.equal(res.nextOffset, null);
  });
});

describe("formatSpillNotice", () => {
  it("is actionable and bounded", () => {
    const notice = formatSpillNotice("abc12345", 100, 5000);
    assert.ok(notice.includes('id="abc12345"'));
    assert.ok(notice.includes("offset: 100"));
    assert.ok(notice.includes("5000"));
  });
});

describe("pruneToolOutputs", () => {
  beforeEach(() => {
    delete process.env.QUBE_TOOL_OUTPUT_MAX_FILES;
    delete process.env.QUBE_TOOL_OUTPUT_RETENTION_HOURS;
  });

  it("caps the number of spilled files per thread", async () => {
    process.env.QUBE_TOOL_OUTPUT_MAX_FILES = "10";
    const t = thread("prune");
    const dir = toolOutputDir(t);
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 13; i++) {
      const name = `spill_${String(i).padStart(2, "0")}_aaaaaa.txt`;
      const path = join(dir, name);
      await writeFile(path, `output ${i}`, "utf-8");
      // Distinct, ordered mtimes so "oldest first" is deterministic.
      const when = new Date(Date.now() - (100 - i) * 1000);
      await utimes(path, when, when);
    }
    const removed = await pruneToolOutputs(t);
    assert.equal(removed, 3);
    const remaining = (await readdir(dir)).filter((f) => f.endsWith(".txt"));
    assert.equal(remaining.length, 10);
    assert.ok(!remaining.includes("spill_00_aaaaaa.txt"));
    assert.ok(remaining.includes("spill_12_aaaaaa.txt"));
  });

  it("deletes files older than the retention window", async () => {
    process.env.QUBE_TOOL_OUTPUT_RETENTION_HOURS = "1";
    const t = thread("expire");
    const dir = toolOutputDir(t);
    await mkdir(dir, { recursive: true });
    const oldPath = join(dir, "old_aaaaaa.txt");
    const freshPath = join(dir, "fresh_aaaaaa.txt");
    await writeFile(oldPath, "old", "utf-8");
    await writeFile(freshPath, "fresh", "utf-8");
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await utimes(oldPath, old, old);
    await pruneToolOutputs(t);
    const remaining = (await readdir(dir)).filter((f) => f.endsWith(".txt"));
    assert.ok(!remaining.includes("old_aaaaaa.txt"));
    assert.ok(remaining.includes("fresh_aaaaaa.txt"));
  });

  it("never throws for an unknown thread", async () => {
    assert.equal(await pruneToolOutputs("no_such_thread"), 0);
  });
});

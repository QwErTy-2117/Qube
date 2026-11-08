/**
 * Checkpoint-store and post-compaction manifest tests.
 *
 * Verifies durable append-only checkpoints, resume planning from the ledger,
 * redaction/bounding, and that the manifest reflects authoritative on-disk
 * state rather than a generated summary.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-checkpoint-test-"));

import { getDataDir } from "@/lib/data-dir";
import {
  beginRun,
  finishRun,
  loadRun,
  recordEvidence,
  recordFileTouched,
  setRunTodos,
} from "@/lib/agent/execution-ledger";
import {
  buildResumePlan,
  clearCheckpoint,
  compactAndCheckpoint,
  formatCheckpointForPrompt,
  loadCheckpoint,
  loadCheckpointHistory,
  saveCheckpoint,
} from "@/lib/agent/checkpoint";
import { buildContextManifest, MAX_MANIFEST_CHARS } from "@/lib/pi/context-manifest";

let counter = 0;
function threadId(name = "checkpoint"): string {
  return `${name}_${Date.now()}_${counter++}`;
}

async function simulateCrash(thread: string): Promise<void> {
  const rec = await loadRun(thread);
  assert.ok(rec);
  rec!.heartbeatAt = Date.now() - 120_000;
  rec!.updatedAt = Date.now() - 120_000;
  await writeFile(join(getDataDir(), ".memory", "runs", `${thread}.json`), JSON.stringify(rec, null, 2), "utf-8");
}

const savedStale = process.env.QUBE_RUN_STALE_MS;

describe("checkpoint store", () => {
  beforeEach(() => {
    process.env.QUBE_RUN_STALE_MS = "600";
  });
  afterEach(() => {
    if (savedStale === undefined) delete process.env.QUBE_RUN_STALE_MS;
    else process.env.QUBE_RUN_STALE_MS = savedStale;
  });

  it("appends, loads and clears checkpoints per thread", async () => {
    const t = threadId();
    assert.equal(await loadCheckpoint(t), null);
    const cp = await saveCheckpoint({
      threadId: t,
      label: "step 1",
      state: { todos: [{ content: "do work", status: "in_progress" }], filesTouched: ["/tmp/a.ts"] },
      summary: "## Objective\nship it",
    });
    assert.ok(cp.id.startsWith("chk_"));
    const loaded = await loadCheckpoint(t);
    assert.ok(loaded);
    assert.equal(loaded!.label, "step 1");
    assert.equal(loaded!.summary, "## Objective\nship it");
    assert.equal(loaded!.state.todos!.length, 1);

    await saveCheckpoint({ threadId: t, label: "step 2", state: {} });
    const history = await loadCheckpointHistory(t);
    assert.equal(history.length, 2);
    assert.equal((await loadCheckpoint(t))!.label, "step 2");

    await clearCheckpoint(t);
    assert.equal(await loadCheckpoint(t), null);
  });

  it("bounds and redacts checkpoint state", async () => {
    const t = threadId("redact");
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const cp = await saveCheckpoint({
      threadId: t,
      label: "secret",
      state: { notes: `${secret} ${"x".repeat(10_000)}` },
    });
    assert.ok(!JSON.stringify(cp.state).includes(secret));
    assert.ok(String(cp.state.notes).length < 10_000);
  });

  it("formats a bounded resume prompt with todos, files and notes", () => {
    const text = formatCheckpointForPrompt({
      id: "chk_1",
      threadId: "t",
      label: "before compaction",
      createdAt: Date.now(),
      state: {
        todos: [{ content: "finish tests", status: "in_progress" }],
        filesTouched: ["/tmp/a.ts", "/tmp/b.ts"],
        notes: "remember the flag",
      },
      summary: "summary body",
    });
    assert.ok(text.includes("finish tests"));
    assert.ok(text.includes("/tmp/a.ts"));
    assert.ok(text.includes("remember the flag"));
    assert.ok(text.includes("summary body"));
    assert.ok(text.length <= 4_000);
  });

  it("does not plan a resume without an execution record", async () => {
    const plan = await buildResumePlan(threadId("none"));
    assert.equal(plan.shouldResume, false);
    assert.equal(plan.reason, "no execution record");
  });

  it("builds a resume plan from an interrupted ledger plus checkpoint", async () => {
    const t = threadId("resume");
    await beginRun({ threadId: t });
    await setRunTodos(t, [
      { content: "open task", status: "in_progress" },
      { content: "done task", status: "completed" },
    ]);
    await recordFileTouched(t, "/tmp/check.ts");
    await saveCheckpoint({ threadId: t, label: "last", state: { notes: "halfway" } });
    await simulateCrash(t);

    const plan = await buildResumePlan(t);
    assert.equal(plan.shouldResume, true);
    assert.ok(plan.reason.includes("interrupted"));
    assert.ok(plan.verificationNeeded.some((v) => v.includes("/tmp/check.ts")));
    assert.ok(plan.verificationNeeded.some((v) => v.includes("open task")));
    assert.ok(plan.resumeNotice);
    assert.ok(plan.resumeNotice!.includes("halfway"));
  });

  it("records a checkpoint even when the context fits", async () => {
    const t = threadId("compact");
    const messages = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      { role: "assistant", parts: [{ type: "text", text: "hi" }] },
    ];
    const res = await compactAndCheckpoint({
      threadId: t,
      messages,
      systemPrompt: "sys",
      state: { notes: "context snapshot" },
    });
    assert.equal(res.compactedMessages.length, 2);
    const cp = await loadCheckpoint(t);
    assert.ok(cp);
    assert.equal(cp!.label, "context checkpoint");
    assert.equal(cp!.state.notes, "context snapshot");
  });
});

describe("post-compaction manifest", () => {
  it("returns nothing without a ledger", async () => {
    assert.equal(await buildContextManifest({ threadId: threadId("empty") }), "");
  });

  it("reflects real todo, file and evidence state", async () => {
    const t = threadId("manifest");
    const dir = mkdtempSync(join(tmpdir(), "qube-manifest-file-"));
    const real = join(dir, "present.txt");
    const missing = join(dir, "missing.txt");
    await writeFile(real, "hello", "utf-8");

    await beginRun({ threadId: t });
    await setRunTodos(t, [
      { content: "finish feature", status: "in_progress" },
      { content: "write docs", status: "completed" },
    ]);
    await recordFileTouched(t, real);
    await recordFileTouched(t, missing);
    await recordEvidence(t, "command_ok", "npm test (exit 0)");
    await finishRun(t, "failed", { error: "tests failed once" });

    const manifest = await buildContextManifest({ threadId: t });
    assert.ok(manifest.includes("Authoritative task state"));
    assert.ok(manifest.includes("1/2 completed"));
    assert.ok(manifest.includes("finish feature"));
    assert.ok(manifest.includes(`${real} — exists`));
    assert.ok(manifest.includes(`${missing} — MISSING`));
    assert.ok(manifest.includes("npm test (exit 0)"));
    assert.ok(manifest.includes("tests failed once"));
    assert.ok(manifest.length <= MAX_MANIFEST_CHARS);
  });

  it("honors a smaller custom bound", async () => {
    const t = threadId("bounded");
    await beginRun({ threadId: t });
    await setRunTodos(t, Array.from({ length: 30 }, (_, i) => ({ content: `task ${i} ${"x".repeat(200)}`, status: "pending" })));
    const manifest = await buildContextManifest({ threadId: t, maxChars: 600 });
    assert.ok(manifest.length <= 600);
  });
});

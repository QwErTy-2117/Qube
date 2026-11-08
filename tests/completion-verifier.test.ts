/**
 * Completion-verifier tests: independent evidence, false-claim detection,
 * conversational pass-through and bounded feedback text.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildVerificationNudge,
  formatUnverifiedNote,
  verifyCompletion,
} from "@/lib/agent/completion-verifier";

const base = {
  toolCalls: 0,
  successfulToolCalls: 0,
  producedText: true,
  sawError: false,
};

describe("verifyCompletion", () => {
  it("does not check pure Q&A turns", async () => {
    const result = await verifyCompletion({ ...base });
    assert.equal(result.checked, false);
    assert.equal(result.complete, true);
    assert.deepEqual(result.reasons, []);
  });

  it("passes work with completed todos, successful tools and existing files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qube-verify-test-"));
    const file = join(dir, "out.txt");
    await writeFile(file, "hello", "utf-8");
    const result = await verifyCompletion({
      ...base,
      todos: [
        { content: "write the file", status: "completed" },
        { content: "verify it", status: "completed" },
      ],
      toolCalls: 3,
      successfulToolCalls: 3,
      filesTouched: [file],
    });
    assert.equal(result.checked, true);
    assert.equal(result.complete, true, result.reasons.join("; "));
    assert.ok(result.evidence.some((e) => e.includes("all 2 todo item(s) completed")));
    assert.ok(result.evidence.some((e) => e.includes("3/3 tool call(s) succeeded")));
    assert.ok(result.evidence.some((e) => e.includes("file exists")));
  });

  it("fails when the model claims a file that is missing on disk", async () => {
    const result = await verifyCompletion({
      ...base,
      toolCalls: 1,
      successfulToolCalls: 1,
      filesTouched: ["/definitely/not/here/output.txt"],
    });
    assert.equal(result.checked, true);
    assert.equal(result.complete, false);
    assert.ok(result.reasons.some((r) => /missing on disk/i.test(r)));
  });

  it("fails on unfinished todos even when text was produced", async () => {
    const result = await verifyCompletion({
      ...base,
      todos: [
        { content: "step one", status: "completed" },
        { content: "step two", status: "in_progress" },
      ],
      toolCalls: 2,
      successfulToolCalls: 2,
    });
    assert.equal(result.complete, false);
    assert.ok(result.reasons.some((r) => /1 todo item\(s\) still unfinished/i.test(r)));
    assert.ok(result.reasons.some((r) => /step two/.test(r)));
  });

  it("fails on an unresolved last tool error", async () => {
    const result = await verifyCompletion({
      ...base,
      toolCalls: 1,
      successfulToolCalls: 0,
      lastToolError: "run_command: exit code 1",
    });
    assert.equal(result.complete, false);
    assert.ok(result.reasons.some((r) => /last tool failure is unresolved/i.test(r)));
  });

  it("fails when every tool call failed", async () => {
    const result = await verifyCompletion({
      ...base,
      toolCalls: 4,
      successfulToolCalls: 0,
    });
    assert.equal(result.complete, false);
    assert.ok(result.reasons.some((r) => /no tool call completed successfully/i.test(r)));
  });

  it("fails when the turn surfaced an error or produced no text", async () => {
    const withError = await verifyCompletion({ ...base, sawError: true, toolCalls: 1, successfulToolCalls: 1 });
    assert.equal(withError.complete, false);
    assert.ok(withError.reasons.some((r) => /surfaced an error/i.test(r)));

    const silent = await verifyCompletion({ ...base, producedText: false, toolCalls: 1, successfulToolCalls: 1 });
    assert.equal(silent.complete, false);
    assert.ok(silent.reasons.some((r) => /no final text/i.test(r)));
  });

  it("bounds the number of file checks", async () => {
    const files = Array.from({ length: 60 }, (_, i) => `/missing/${i}.txt`);
    const result = await verifyCompletion({
      ...base,
      toolCalls: 1,
      successfulToolCalls: 1,
      filesTouched: files,
      maxFileChecks: 3,
    });
    assert.equal(result.reasons.length, 3);
    assert.ok(result.evidence.some((e) => /first 3 of 60 touched files/i.test(e)));
  });
});

describe("verification feedback", () => {
  it("builds a silent nudge naming the failures", () => {
    const nudge = buildVerificationNudge({
      checked: true,
      complete: false,
      reasons: ["claimed output is missing on disk: /x", "1 todo still unfinished"],
      evidence: [],
    });
    assert.ok(nudge.includes("NOT a user message"));
    assert.ok(nudge.includes("missing on disk"));
    assert.ok(nudge.includes("Do not claim completion"));
  });

  it("formats an honest partial note for the final answer", () => {
    const note = formatUnverifiedNote({
      checked: true,
      complete: false,
      reasons: ["a", "b", "c", "d"],
      evidence: [],
    });
    assert.ok(note.includes("could not fully verify"));
    assert.ok(note.includes("a; b; c"));
    assert.ok(!note.includes("; d"));
    assert.ok(note.includes("partial"));
  });
});

/**
 * Execution-ledger tests: durable run state, orphan detection, one-time
 * resume notices, write-ahead journaling and idempotent replay.
 *
 * "Process restart" is simulated by rewriting the persisted ledger with an
 * old heartbeat, which is exactly what a crashed process leaves behind.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-ledger-test-"));

import { getDataDir } from "@/lib/data-dir";
import {
  beginRun,
  findReplayableResult,
  finishRun,
  heartbeatRun,
  isMutatingToolName,
  isReplayableToolName,
  loadRun,
  recordEvidence,
  recordFileTouched,
  setRunTodos,
  sweepOrphanRuns,
  toolFinished,
  toolJournalKey,
  toolStarted,
} from "@/lib/agent/execution-ledger";

let counter = 0;
function threadId(name = "ledger"): string {
  return `${name}_${Date.now()}_${counter++}`;
}

function ledgerPath(thread: string): string {
  return join(getDataDir(), ".memory", "runs", `${thread}.json`);
}

async function simulateCrash(thread: string, ageMs = 120_000): Promise<void> {
  const rec = await loadRun(thread);
  assert.ok(rec, "ledger exists before crash");
  rec!.heartbeatAt = Date.now() - ageMs;
  rec!.updatedAt = Date.now() - ageMs;
  await writeFile(ledgerPath(thread), JSON.stringify(rec, null, 2), "utf-8");
}

const savedStale = process.env.QUBE_RUN_STALE_MS;

describe("execution ledger", () => {
  beforeEach(() => {
    process.env.QUBE_RUN_STALE_MS = "600";
  });
  afterEach(() => {
    if (savedStale === undefined) delete process.env.QUBE_RUN_STALE_MS;
    else process.env.QUBE_RUN_STALE_MS = savedStale;
  });

  it("persists a running record with lifecycle fields", async () => {
    const t = threadId();
    await beginRun({ threadId: t, modelName: "test-model" });
    const rec = await loadRun(t);
    assert.ok(rec);
    assert.equal(rec!.status, "running");
    assert.equal(rec!.modelName, "test-model");
    assert.equal(rec!.toolCalls, 0);
    assert.ok(rec!.runId.startsWith("run_"));
    assert.ok(rec!.heartbeatAt >= rec!.startedAt);
  });

  it("marks a stale run interrupted and returns a one-time resume notice", async () => {
    const t = threadId("resume");
    await beginRun({ threadId: t });
    await setRunTodos(t, [
      { content: "implement feature", status: "in_progress" },
      { content: "already done", status: "completed" },
    ]);
    await recordFileTouched(t, "/workspace/src/a.ts");
    await simulateCrash(t);

    const resumed = await beginRun({ threadId: t });
    assert.ok(resumed.resume);
    assert.equal(resumed.resume!.todos.length, 1);
    assert.ok(resumed.resume!.notice.includes("implement feature"));
    assert.ok(resumed.resume!.notice.includes("Files touched"));
    assert.ok(resumed.resume!.notice.includes("verify"));

    // Notice is delivered exactly once: a second restart must not repeat it.
    await simulateCrash(t);
    const again = await beginRun({ threadId: t });
    assert.equal(again.resume, undefined);
  });

  it("does not resume a cleanly finished run", async () => {
    const t = threadId("clean");
    await beginRun({ threadId: t });
    await finishRun(t, "completed");
    const next = await beginRun({ threadId: t });
    assert.equal(next.resume, undefined);
    assert.equal((await loadRun(t))!.status, "running");
  });

  it("sweeps stale runs without touching live ones", async () => {
    const fresh = threadId("fresh");
    const stale = threadId("stale");
    await beginRun({ threadId: fresh });
    await beginRun({ threadId: stale });
    await simulateCrash(stale);

    const swept = await sweepOrphanRuns();
    assert.ok(swept >= 1);
    assert.equal((await loadRun(stale))!.status, "interrupted");
    assert.equal((await loadRun(fresh))!.status, "running");
  });

  it("tracks heartbeat, todos and evidence", async () => {
    const t = threadId("state");
    await beginRun({ threadId: t });
    const before = (await loadRun(t))!.heartbeatAt;
    await new Promise((r) => setTimeout(r, 5));
    await heartbeatRun(t, { iterations: 42 });
    let rec = (await loadRun(t))!;
    assert.ok(rec.heartbeatAt > before);
    assert.equal(rec.iterations, 42);

    await setRunTodos(t, [{ content: "task", status: "pending", activeForm: "doing task" }]);
    await recordEvidence(t, "command_ok", "npm test (exit 0)");
    await recordFileTouched(t, "/tmp/a");
    await recordFileTouched(t, "/tmp/b");
    await recordFileTouched(t, "/tmp/a");
    rec = (await loadRun(t))!;
    assert.equal(rec.todos!.length, 1);
    assert.equal(rec.todos![0].activeForm, "doing task");
    assert.ok(rec.evidence.some((e) => e.kind === "command_ok"));
    // Deduplicated, most recent last.
    assert.deepEqual(rec.filesTouched, ["/tmp/b", "/tmp/a"]);
  });

  it("journals mutating calls before execution and records the outcome", async () => {
    const t = threadId("journal");
    await beginRun({ threadId: t });
    assert.equal(isMutatingToolName("write_file"), true);
    assert.equal(isMutatingToolName("send_email"), true);
    assert.equal(isMutatingToolName("read_file"), false);
    assert.equal(isReplayableToolName("write_file"), true);
    assert.equal(isReplayableToolName("send_email"), false);

    const args = { path: "/tmp/out.txt", content: "hello" };
    const key = await toolStarted(t, "write_file", args);
    assert.equal(key, toolJournalKey("write_file", args));
    let rec = (await loadRun(t))!;
    assert.equal(rec.journal.length, 1);
    assert.equal(rec.journal[0].state, "pending");

    await toolFinished(t, "write_file", key, { ok: true, result: '{"status":"written"}' });
    rec = (await loadRun(t))!;
    assert.equal(rec.journal[0].state, "ok");
    assert.equal(rec.toolCalls, 1);
    assert.equal(rec.toolFailures, 0);
  });

  it("replays a completed file mutation with identical arguments only", async () => {
    const t = threadId("replay");
    await beginRun({ threadId: t });
    const args = { path: "/tmp/replay.txt", content: "v1" };
    const key = await toolStarted(t, "write_file", args);

    assert.equal(await findReplayableResult(t, "write_file", args), null);
    await toolFinished(t, "write_file", key, { ok: true, result: '{"path":"/tmp/replay.txt","status":"written"}' });

    const replay = await findReplayableResult(t, "write_file", args);
    assert.ok(replay);
    assert.equal(replay!.key, key);
    assert.match(replay!.result, /written/);

    // Different content is a different action, not a replay.
    assert.equal(await findReplayableResult(t, "write_file", { path: "/tmp/replay.txt", content: "v2" }), null);
    // Failed calls are never replayed as success.
    assert.equal(await findReplayableResult(t, "send_email", args), null);
  });

  it("surfaces unknown-outcome actions in the resume notice", async () => {
    const t = threadId("pending");
    await beginRun({ threadId: t });
    await toolStarted(t, "write_file", { path: "/tmp/maybe.txt", content: "x" });
    await simulateCrash(t);

    const resumed = await beginRun({ threadId: t });
    assert.ok(resumed.resume);
    assert.equal(resumed.resume!.pendingTools.length, 1);
    assert.ok(/UNKNOWN outcome/i.test(resumed.resume!.notice));
    assert.ok(/Do not blindly retry/i.test(resumed.resume!.notice));
  });

  it("does not replay a pending action from a crashed run", async () => {
    const t = threadId("no-replay-pending");
    await beginRun({ threadId: t });
    const args = { path: "/tmp/pending.txt", content: "x" };
    await toolStarted(t, "write_file", args);
    await simulateCrash(t);
    await beginRun({ threadId: t });
    assert.equal(await findReplayableResult(t, "write_file", args), null);
  });

  it("resolves dangling journal entries when the run finishes", async () => {
    const t = threadId("finish");
    await beginRun({ threadId: t });
    const key = await toolStarted(t, "write_file", { path: "/tmp/f.txt", content: "x" });
    await finishRun(t, "failed", { error: "boom" });
    let rec = (await loadRun(t))!;
    assert.equal(rec.status, "failed");
    assert.equal(rec.lastError, "boom");
    assert.equal(rec.journal.find((j) => j.key === key)!.state, "error");

    const t2 = threadId("finish-ok");
    await beginRun({ threadId: t2 });
    const key2 = await toolStarted(t2, "edit_file", { path: "/tmp/g.txt", oldString: "a", newString: "b" });
    await finishRun(t2, "completed");
    rec = (await loadRun(t2))!;
    // Never claim an unconfirmed write succeeded, even on a clean finish.
    assert.equal(rec.journal.find((j) => j.key === key2)!.state, "error");
  });

  it("stays bounded across hundreds of tool calls", async () => {
    const t = threadId("longrun");
    await beginRun({ threadId: t });
    for (let i = 0; i < 250; i++) {
      const args = { path: `/tmp/long-${i}.txt`, content: "x" };
      const key = await toolStarted(t, "write_file", args);
      await toolFinished(t, "write_file", key, { ok: true, result: "written" });
    }
    for (let i = 0; i < 80; i++) await recordEvidence(t, i % 2 ? "command_ok" : "note", `evidence ${i}`);
    for (let i = 0; i < 80; i++) await recordFileTouched(t, `/tmp/long-${i}.txt`);

    const rec = (await loadRun(t))!;
    assert.equal(rec.status, "running");
    assert.equal(rec.toolCalls, 250);
    assert.equal(rec.toolFailures, 0);
    assert.ok(rec.journal.length <= 40, `journal bounded: ${rec.journal.length}`);
    assert.ok(rec.evidence.length <= 30, `evidence bounded: ${rec.evidence.length}`);
    assert.ok(rec.filesTouched.length <= 50, `files bounded: ${rec.filesTouched.length}`);
    // The most recent file mutation is still replayable; older ones are pruned.
    assert.ok(await findReplayableResult(t, "write_file", { path: "/tmp/long-249.txt", content: "x" }));
    await finishRun(t, "completed");
    assert.equal((await loadRun(t))!.status, "completed");
  });

  it("tolerates a corrupt ledger file", async () => {
    const t = threadId("corrupt");
    await beginRun({ threadId: t });
    await writeFile(ledgerPath(t), "{not json", "utf-8");
    assert.equal(await loadRun(t), null);
    const next = await beginRun({ threadId: t });
    assert.equal(next.resume, undefined);
    assert.equal(next.ledger.status, "running");
    // Sanity: the rewritten file is valid JSON again.
    JSON.parse(await readFile(ledgerPath(t), "utf-8"));
  });
});

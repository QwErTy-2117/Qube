import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-dsched-test-"));
import { scheduleTaskTool, updateHeartbeatTool } from "@/lib/pi/durable-scheduler";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-sched" } as never;

function outputText(result: unknown): string {
  return (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
}

describe("durable scheduler tools", () => {
  it("rejects schedule creates without a recurring cue", async () => {
    const parsed = JSON.parse(outputText(await scheduleTaskTool.execute(
      { action: "create", name: "x", instructions: "check the price of X", scheduleKind: "interval", intervalMinutes: 60 } as never,
      fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.match(parsed.error, /one-shot lookup/);
  });

  it("creates, lists, gets, updates, and deletes a task", async () => {
    const created = JSON.parse(outputText(await scheduleTaskTool.execute(
      {
        action: "create", name: "daily ping", instructions: "Ping the team every day with a status report",
        scheduleKind: "interval", intervalMinutes: 1440,
      } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.ok(created.task?.id, JSON.stringify(created).slice(0, 200));
    const id = created.task.id;

    const listed = JSON.parse(outputText(await scheduleTaskTool.execute({ action: "list" } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.ok(listed.tasks.some((t: { id: string }) => t.id === id));

    const got = JSON.parse(outputText(await scheduleTaskTool.execute({ action: "get", id } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(got.task.name, "daily ping");

    const updated = JSON.parse(outputText(await scheduleTaskTool.execute(
      { action: "update", id, name: "daily ping v2" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(updated.task.name, "daily ping v2");

    const deleted = JSON.parse(outputText(await scheduleTaskTool.execute({ action: "delete", id } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(deleted.message, "Task deleted.");
    const relisted = JSON.parse(outputText(await scheduleTaskTool.execute({ action: "list" } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.ok(!relisted.tasks.some((t: { id: string }) => t.id === id));
  });

  it("inspects heartbeat state and saves a finding once", async () => {
    const got = JSON.parse(outputText(await updateHeartbeatTool.execute({ action: "get" } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.ok("state" in got);
    const topic = `Test finding ${Date.now()}`;
    const noted = JSON.parse(outputText(await updateHeartbeatTool.execute(
      { action: "note", topic, evidence: "unit test" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.match(noted.message, /saved for next chat|Suppressed|Duplicate/);
  });
});

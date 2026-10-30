import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-none-test-"));

import { createTask, updateTask, updateTaskRunTime, getTask } from "@/lib/scheduler/task-store";

describe("none-schedule tasks", () => {
  it("creates with null nextRunAt and survives a round-trip", async () => {
    const t = await createTask({ name: "Backlog", instructions: "Do it at heartbeat.", scheduleKind: "none" });
    assert.equal(t.schedule.kind, "none");
    assert.equal(t.nextRunAt, null);
    const again = await getTask(t.id);
    assert.equal(again?.nextRunAt, null);
  });

  it("keeps nextRunAt null after updateTaskRunTime", async () => {
    const t = await createTask({ name: "Backlog 2", instructions: "Do it.", scheduleKind: "none" });
    await updateTaskRunTime(t.id, true);
    const again = await getTask(t.id);
    assert.ok((again?.lastRunAt ?? 0) > 0);
    assert.equal(again?.nextRunAt, null);
  });

  it("switching kinds resets nextRunAt correctly", async () => {
    const t = await createTask({ name: "Switch", instructions: "x", scheduleKind: "interval", intervalMinutes: 60 });
    assert.ok((t.nextRunAt ?? 0) > Date.now());
    const toNone = await updateTask(t.id, { schedule: { kind: "none" } as never });
    assert.equal(toNone?.nextRunAt, null);
  });
});

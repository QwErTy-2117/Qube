import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isTaskDone } from "@/lib/scheduler/board-status";

const PERMS = { runCommands: false, destructiveCommands: false, externalFiles: false, webAccess: false };
const NOW = 1_800_000_000_000;

function base(over: Record<string, unknown> = {}) {
  return {
    id: "t",
    type: "scheduled",
    name: "T",
    instructions: "Do it.",
    schedule: { kind: "interval", intervalMinutes: 60 },
    enabled: true,
    permissions: PERMS,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    lastRunAt: null,
    nextRunAt: NOW + 3_600_000,
    ...over,
  } as never;
}

describe("isTaskDone", () => {
  it("is false before any run", () => {
    assert.equal(isTaskDone(base(), NOW), false);
  });

  it("marks once tasks done after a run", () => {
    const t = base({ schedule: { kind: "once", runAt: NOW + 1000 }, lastRunAt: NOW });
    assert.equal(isTaskDone(t, NOW), true);
  });

  it("marks interval tasks done inside the window", () => {
    const t = base({ lastRunAt: NOW - 1_000, nextRunAt: NOW + 3_599_000 });
    assert.equal(isTaskDone(t, NOW), true);
  });

  it("returns interval tasks to not-done after nextRunAt passes", () => {
    const t = base({ lastRunAt: NOW - 10_000_000, nextRunAt: NOW - 1_000 });
    assert.equal(isTaskDone(t, NOW), false);
  });

  it("marks wall-clock daily tasks done (no intervalMinutes)", () => {
    const t = base({
      schedule: { kind: "interval", hour: 6, minute: 0 },
      lastRunAt: NOW - 1_000,
      nextRunAt: NOW + 80_000_000,
    });
    assert.equal(isTaskDone(t, NOW), true);
  });

  it("keeps done after a manual re-run inside the period", () => {
    const t = base({ lastRunAt: NOW - 500, nextRunAt: NOW + 3_599_500 });
    assert.equal(isTaskDone(t, NOW), true);
  });
});

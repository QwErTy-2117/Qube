/**
 * Task calendar mapping: task → calendar block/occurrences.
 *
 * The settings Tasks tab renders the ReUI event calendar, so these pure
 * helpers are the contract between the scheduler data model and the calendar:
 * one-shot tasks map to a single block, recurring tasks expand inside the
 * visible range, and the dialog's Repeat picker round-trips existing
 * schedules without rewriting them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compactTime,
  repeatValueFor,
  taskBlock,
  taskDurationMinutes,
  taskOccurrencesInRange,
} from "@/lib/scheduler/calendar";
import type { ScheduledTask } from "@/lib/scheduler/types";

const PERMS = {
  runCommands: false,
  destructiveCommands: false,
  externalFiles: false,
  webAccess: false,
};

const AT_9 = new Date(2026, 10, 10, 9, 0, 0, 0);

function task(over: Partial<ScheduledTask> & Pick<ScheduledTask, "schedule">): ScheduledTask {
  return {
    id: "task_1",
    type: "scheduled",
    name: "Task",
    instructions: "Do it.",
    enabled: true,
    permissions: PERMS,
    createdAt: AT_9.getTime(),
    updatedAt: AT_9.getTime(),
    lastRunAt: null,
    nextRunAt: AT_9.getTime(),
    ...over,
  } as ScheduledTask;
}

function november() {
  return {
    start: new Date(2026, 10, 1, 0, 0, 0, 0),
    end: new Date(2026, 11, 1, 0, 0, 0, 0),
  };
}

describe("taskDurationMinutes", () => {
  it("defaults to 30 and never goes below 5", () => {
    assert.equal(taskDurationMinutes({}), 30);
    assert.equal(taskDurationMinutes({ durationMinutes: 90 }), 90);
    assert.equal(taskDurationMinutes({ durationMinutes: 0 }), 5);
  });
});

describe("taskBlock", () => {
  it("anchors a one-shot task on its run time", () => {
    const runAt = new Date(2026, 10, 20, 14, 30).getTime();
    const block = taskBlock(
      task({ schedule: { kind: "once", runAt }, nextRunAt: runAt, durationMinutes: 45 }),
    );
    assert.equal(block.start.getTime(), runAt);
    assert.equal(block.end.getTime() - block.start.getTime(), 45 * 60_000);
    assert.equal(block.allDay, false);
  });

  it("anchors a recurring task on its next run", () => {
    const next = new Date(2026, 10, 11, 6, 0).getTime();
    const block = taskBlock(
      task({
        schedule: { kind: "interval", intervalMinutes: 1440, hour: 6, minute: 0 },
        nextRunAt: next,
      }),
    );
    assert.equal(block.start.getTime(), next);
  });

  it("snaps all-day blocks to midnight boundaries", () => {
    const block = taskBlock(
      task({
        schedule: { kind: "once", runAt: new Date(2026, 10, 20, 14, 30).getTime() },
        nextRunAt: new Date(2026, 10, 20, 14, 30).getTime(),
        allDay: true,
      }),
    );
    assert.equal(block.start.getHours(), 0);
    assert.equal(block.start.getMinutes(), 0);
    assert.equal(block.end.getTime() - block.start.getTime(), 24 * 60 * 60 * 1000);
    assert.equal(block.allDay, true);
  });
});

describe("taskOccurrencesInRange", () => {
  it("returns null for one-shot tasks so the single-event path owns them", () => {
    const t = task({ schedule: { kind: "once", runAt: AT_9.getTime() } });
    assert.equal(taskOccurrencesInRange(t, november()), null);
  });

  it("expands a daily wall-clock task once per day", () => {
    const t = task({
      schedule: { kind: "interval", intervalMinutes: 1440, hour: 9, minute: 15 },
    });
    const occurrences = taskOccurrencesInRange(t, november())!;
    assert.equal(occurrences.length, 30);
    assert.equal(occurrences[0].start.getHours(), 9);
    assert.equal(occurrences[0].start.getMinutes(), 15);
  });

  it("only expands the selected weekday for weekly tasks", () => {
    // 2026-11-01 is a Sunday; weekdays use 0=Sun..6=Sat.
    const t = task({
      schedule: {
        kind: "interval",
        intervalMinutes: 10_080,
        hour: 10,
        minute: 0,
        weekdays: [1],
      },
    });
    const occurrences = taskOccurrencesInRange(t, november())!;
    // November 2026 has five Mondays: 2, 9, 16, 23 and 30.
    assert.equal(occurrences.length, 5);
    for (const occurrence of occurrences) assert.equal(occurrence.start.getDay(), 1);
  });

  it("only expands the selected day of month for monthly tasks", () => {
    const t = task({
      schedule: {
        kind: "interval",
        intervalMinutes: 43_200,
        hour: 8,
        minute: 0,
        monthDay: 15,
      },
    });
    const occurrences = taskOccurrencesInRange(t, november())!;
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].start.getDate(), 15);
    assert.equal(occurrences[0].start.getHours(), 8);
  });

  it("collapses sub-daily cadences to one chip per day on a month grid", () => {
    const t = task({
      schedule: { kind: "interval", intervalMinutes: 60 },
      nextRunAt: new Date(2026, 10, 1, 0, 0).getTime(),
    });
    const occurrences = taskOccurrencesInRange(t, november())!;
    assert.equal(occurrences.length, 30);
    const days = new Set(occurrences.map((o) => o.start.getDate()));
    assert.equal(days.size, 30);
  });

  it("keeps every run on a short range (week view)", () => {
    const t = task({
      schedule: { kind: "interval", intervalMinutes: 60 },
      nextRunAt: new Date(2026, 10, 1, 0, 0).getTime(),
    });
    const occurrences = taskOccurrencesInRange(t, {
      start: new Date(2026, 10, 1, 0, 0, 0, 0),
      end: new Date(2026, 10, 2, 0, 0, 0, 0),
    })!;
    assert.equal(occurrences.length, 24);
  });

  it("emits all-day blocks for recurring all-day tasks", () => {
    const t = task({
      schedule: { kind: "interval", intervalMinutes: 1440, hour: 0, minute: 0 },
      allDay: true,
    });
    const occurrences = taskOccurrencesInRange(t, november())!;
    assert.equal(occurrences.length, 30);
    for (const occurrence of occurrences) {
      assert.equal(occurrence.start.getHours(), 0);
      assert.equal(occurrence.end.getTime() - occurrence.start.getTime(), 24 * 60 * 60 * 1000);
    }
  });
});

describe("repeatValueFor", () => {
  it("recognises the presets the dialog offers", () => {
    assert.equal(repeatValueFor({ schedule: { kind: "once" } }), "once");
    assert.equal(
      repeatValueFor({ schedule: { kind: "interval", intervalMinutes: 60 } }),
      "hourly",
    );
    assert.equal(
      repeatValueFor({ schedule: { kind: "interval", intervalMinutes: 1440, hour: 9 } }),
      "daily",
    );
    assert.equal(
      repeatValueFor({
        schedule: { kind: "interval", intervalMinutes: 10_080, hour: 9, weekdays: [5] },
      }),
      "weekly",
    );
    assert.equal(
      repeatValueFor({
        schedule: { kind: "interval", intervalMinutes: 43_200, hour: 9, monthDay: 1 },
      }),
      "monthly",
    );
  });

  it("keeps an unknown cadence as custom so saving never rewrites it", () => {
    assert.equal(
      repeatValueFor({ schedule: { kind: "interval", intervalMinutes: 17 } }),
      "custom",
    );
  });
});

describe("compactTime", () => {
  it("drops :00 and uses a lowercase meridiem", () => {
    assert.equal(compactTime(new Date(2026, 10, 1, 9, 0)), "9am");
    assert.equal(compactTime(new Date(2026, 10, 1, 13, 5)), "1:05pm");
    assert.equal(compactTime(new Date(2026, 10, 1, 0, 30)), "12:30am");
  });
});

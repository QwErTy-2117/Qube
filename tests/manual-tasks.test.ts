import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-manual-test-"));

import { manualTaskMarker, parseManualTaskRef, linkManualTaskReminder, unlinkManualTaskReminder } from "@/lib/scheduler/manual-tasks";

describe("manual task heartbeat link", () => {
  it("round-trips the marker", () => {
    const desc = manualTaskMarker("task_abc123", "Water plants", "Remind me to water the plants");
    assert.match(desc, /\[manual-task:task_abc123\]/);
    assert.equal(parseManualTaskRef(desc), "task_abc123");
    assert.equal(parseManualTaskRef("plain reminder"), null);
  });

  it("links and unlinks a reminder in heartbeat state", async () => {
    const { loadHeartbeatState } = await import("@/lib/scheduler/heartbeat-state");
    await linkManualTaskReminder("task_link_1", "T", "Do T.");
    let state = await loadHeartbeatState();
    assert.ok(state.pendingActions.some((a) => a.description.includes("task_link_1")));
    await unlinkManualTaskReminder("task_link_1");
    state = await loadHeartbeatState();
    assert.ok(!state.pendingActions.some((a) => a.description.includes("task_link_1")));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDraftPrompt, validateDraft, type TaskDraft, type DraftInput } from "@/lib/scheduler/task-draft";

describe("buildDraftPrompt", () => {
  it("includes the user prompt, current draft, date and timezone", () => {
    const current: DraftInput = { name: "Report", instructions: "Old.", scheduleKind: "interval", intervalMinutes: 1440 };
    const p = buildDraftPrompt("every morning at 6 send it", current);
    assert.match(p, /every morning at 6 send it/);
    assert.match(p, /"name": "Report"/);
    assert.match(p, /"scheduleKind": "interval"/);
    assert.match(p, /current date/i);
  });

  it("works without a current draft", () => {
    const p = buildDraftPrompt("remind me Friday", null);
    assert.match(p, /remind me Friday/);
  });
});

describe("validateDraft", () => {
  const good: TaskDraft = { name: "Report", instructions: "Send it.", scheduleKind: "interval", intervalMinutes: 1440 };

  it("accepts a good draft", () => {
    assert.deepEqual(validateDraft(good).ok, true);
  });

  it("rejects empty name/instructions", () => {
    assert.equal(validateDraft({ ...good, name: " " }).ok, false);
    assert.equal(validateDraft({ ...good, instructions: "" }).ok, false);
  });

  it("rejects unknown schedule kinds", () => {
    assert.equal(validateDraft({ ...good, scheduleKind: "yearly" }).ok, false);
  });

  it("checks timing ranges", () => {
    assert.equal(validateDraft({ ...good, hour: 25 }).ok, false);
    assert.equal(validateDraft({ ...good, minute: 60 }).ok, false);
    assert.equal(validateDraft({ ...good, weekdays: [7] }).ok, false);
    assert.equal(validateDraft({ ...good, intervalMinutes: 0 }).ok, false);
    assert.equal(validateDraft({ name: "X", instructions: "Y", scheduleKind: "once", runAt: "not-a-date" }).ok, false);
    const past = new Date(Date.now() - 60_000).toISOString();
    assert.equal(validateDraft({ name: "X", instructions: "Y", scheduleKind: "once", runAt: past }).ok, false);
  });

  it("trims strings and passes none through", () => {
    const r = validateDraft({ name: "  T  ", instructions: " Do. ", scheduleKind: "none" });
    assert.equal(r.ok, true);
    assert.equal((r as { draft: TaskDraft }).draft.name, "T");
  });
});

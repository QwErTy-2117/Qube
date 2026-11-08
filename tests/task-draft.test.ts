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

  it("accepts heartbeat reminders only when the caller allows manual tasks", () => {
    const manual = { name: "Water plants", instructions: "Water the plants on the balcony.", scheduleKind: "none" };
    assert.equal(validateDraft(manual).ok, false);
    const allowed = validateDraft(manual, { allowManual: true });
    assert.equal(allowed.ok, true);
    if (allowed.ok) {
      assert.equal(allowed.draft.scheduleKind, "none");
      assert.equal(allowed.draft.intervalMinutes, undefined);
      assert.equal(allowed.draft.runAt, undefined);
    }
  });

  it("validates title-only drafts for blank reminder titles", async () => {
    const { validateTitleDraft } = await import("@/lib/scheduler/task-draft");
    assert.deepEqual(validateTitleDraft({ name: "  Water the plants  " }), { ok: true, name: "Water the plants" });
    assert.equal(validateTitleDraft({ name: " " }).ok, false);
    assert.equal(validateTitleDraft("nope").ok, false);
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

  it("trims strings and defaults a one-shot draft to a future time", () => {
    const r = validateDraft({ name: "  T  ", instructions: " Do. ", scheduleKind: "once" });
    assert.equal(r.ok, true);
    const draft = (r as { draft: TaskDraft }).draft;
    assert.equal(draft.name, "T");
    assert.ok(draft.runAt);
    assert.ok(Date.parse(draft.runAt!) > Date.now());
  });
});

/**
 * Next Task dialog regression tests.
 *
 * The dialog itself is React, so the pure pieces it depends on are locked
 * here: the draft validator's timing rules (the same rules the dialog's
 * Save button enforces) and the defaults the date picker fills in. The
 * dialog's own logic was kept thin on purpose so these rules are the whole
 * contract.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateDraft, buildDraftPrompt, buildDraftSystemPrompt } from "@/lib/scheduler/task-draft";

const HOUR = 60 * 60 * 1000;

function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

describe("next task: draft validation", () => {
  it("accepts a one-off task scheduled in the future", () => {
    const result = validateDraft({
      name: "Send the report",
      instructions: "Send the weekly report to the team.",
      scheduleKind: "once",
      runAt: inMinutes(90),
    });
    assert.equal(result.ok, true);
  });

  it("rejects a one-off task scheduled in the past (the dialog's inline hint)", () => {
    const result = validateDraft({
      name: "Too late",
      instructions: "Should have run already.",
      scheduleKind: "once",
      runAt: new Date(Date.now() - HOUR).toISOString(),
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /future/i);
  });

  it("rejects a malformed date instead of saving a silent default", () => {
    const result = validateDraft({
      name: "Bad date",
      instructions: "Whatever.",
      scheduleKind: "once",
      runAt: "next tuesday",
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /ISO/i);
  });

  it("requires a name and instructions (Save stays disabled without them)", () => {
    assert.equal(validateDraft({ name: " ", instructions: "x", scheduleKind: "none" }).ok, false);
    assert.equal(validateDraft({ name: "x", instructions: "  ", scheduleKind: "none" }).ok, false);
  });

  it("keeps recurring schedules usable without a runAt", () => {
    assert.equal(validateDraft({ name: "Daily", instructions: "Check the inbox.", scheduleKind: "interval", intervalMinutes: 60 }).ok, true);
    assert.equal(validateDraft({ name: "Manual", instructions: "Only when I ask.", scheduleKind: "none" }).ok, true);
  });

  it("checks the wall-clock ranges a user can type", () => {
    assert.equal(validateDraft({ name: "Morning", instructions: "x", scheduleKind: "interval", hour: 24 }).ok, false);
    assert.equal(validateDraft({ name: "Morning", instructions: "x", scheduleKind: "interval", hour: 9, minute: 30 }).ok, true);
    assert.equal(validateDraft({ name: "Weird", instructions: "x", scheduleKind: "interval", weekdays: [7] }).ok, false);
  });

  it("trims the name and caps it at 120 characters", () => {
    const result = validateDraft({ name: `  ${"a".repeat(200)}  `, instructions: "x", scheduleKind: "none" });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.draft.name.length, 120);
    assert.equal(result.ok && result.draft.name.startsWith(" "), false);
  });
});

describe("next task: prompt context", () => {
  it("tells the model the current time so relative dates resolve", () => {
    const prompt = buildDraftPrompt("remind me tomorrow at 9", null);
    assert.match(prompt, /Current date\/time:/);
    assert.match(prompt, /timezone offset/);
    assert.match(prompt, /remind me tomorrow at 9/);
  });

  it("carries the existing draft so an edit is a revision, not a new task", () => {
    const prompt = buildDraftPrompt("make it weekly", {
      name: "Report",
      instructions: "Send it.",
      scheduleKind: "interval",
      intervalMinutes: 1440,
    });
    assert.match(prompt, /Current draft/);
    assert.match(prompt, /1440/);
  });

  it("keeps the JSON-only contract in the system prompt", () => {
    const system = buildDraftSystemPrompt();
    assert.match(system, /ONE JSON object/);
    assert.match(system, /runAt/);
  });
});

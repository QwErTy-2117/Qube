import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  draftFromInstructions,
  extractJsonObject,
  parseJsonLoose,
  titleFromInstructions,
  validateDraft,
} from "@/lib/scheduler/task-draft";

describe("extractJsonObject", () => {
  it("pulls the object out of prose", () => {
    assert.equal(
      extractJsonObject('Sure! Here it is:\n{"a": 1}\nHope that helps.'),
      '{"a": 1}',
    );
  });

  it("handles fences and nested objects", () => {
    assert.equal(
      extractJsonObject('```json\n{"a": {"b": 2}}\n```'),
      '{"a": {"b": 2}}',
    );
  });

  it("ignores braces inside strings", () => {
    assert.equal(
      extractJsonObject('{"name": "use {curly} braces"}'),
      '{"name": "use {curly} braces"}',
    );
  });

  it("returns null when there is no object", () => {
    assert.equal(extractJsonObject("no json here"), null);
    assert.equal(extractJsonObject(""), null);
  });
});

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  });

  it("repairs trailing commas and smart quotes", () => {
    assert.deepEqual(parseJsonLoose('{"a":1,}'), { a: 1 });
    assert.deepEqual(parseJsonLoose('{\u201ca\u201d: 1}'), { a: 1 });
  });

  it("returns null for garbage", () => {
    assert.equal(parseJsonLoose("not json"), null);
  });
});

describe("titleFromInstructions", () => {
  it("drops conversational lead-ins", () => {
    assert.equal(titleFromInstructions("Remind me to call the dentist"), "Call the dentist");
    assert.equal(titleFromInstructions("please remember to pay rent"), "Pay rent");
  });

  it("caps the title length and never returns blank", () => {
    const long = titleFromInstructions(
      "review every single one of the quarterly budget spreadsheets and reconcile them carefully",
    );
    assert.ok(long.length <= 60);
    assert.equal(titleFromInstructions(""), "New task");
  });
});

describe("draftFromInstructions", () => {
  it("recognises explicit intervals", () => {
    const d = draftFromInstructions("check the price every 2 hours");
    assert.equal(d.scheduleKind, "interval");
    assert.equal(d.intervalMinutes, 120);
  });

  it("recognises daily cadences with a clock time", () => {
    const d = draftFromInstructions("send me a summary every day at 8:30 am");
    assert.equal(d.scheduleKind, "interval");
    assert.equal(d.intervalMinutes, 1440);
    assert.equal(d.hour, 8);
    assert.equal(d.minute, 30);
  });

  it("does not mistake a quantity for a clock time", () => {
    const d = draftFromInstructions("buy 2 apples every day");
    assert.equal(d.scheduleKind, "interval");
    assert.equal(d.hour, 9);
    assert.equal(d.minute, 0);
  });

  it("produces a valid draft the store can save", () => {
    const d = draftFromInstructions("water the plants on friday");
    const validated = validateDraft(d);
    assert.equal(validated.ok, true);
  });

  it("uses a manual reminder when the caller allows it", () => {
    const d = draftFromInstructions("buy milk", { allowManual: true });
    assert.equal(d.scheduleKind, "none");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTitlePrompt,
  buildTitleSystemPrompt,
  validateTitleDraft,
} from "@/lib/scheduler/task-draft";

describe("buildTitleSystemPrompt", () => {
  it("demands one short, concrete JSON title", () => {
    const prompt = buildTitleSystemPrompt();
    assert.match(prompt, /ONE JSON object/);
    assert.match(prompt, /short, concrete title/);
    assert.match(prompt, /never a generic label/);
  });
});

describe("buildTitlePrompt", () => {
  it("uses only the instructions text", () => {
    const prompt = buildTitlePrompt("check the price of the flights every morning");
    assert.match(prompt, /Reminder instructions:/);
    assert.match(prompt, /check the price of the flights every morning/);
    assert.doesNotMatch(prompt, /scheduleKind/);
  });
});

describe("validateTitleDraft", () => {
  it("accepts a trimmed name", () => {
    assert.deepEqual(validateTitleDraft({ name: "  Water the plants  " }), {
      ok: true,
      name: "Water the plants",
    });
  });

  it("rejects empty and non-object titles", () => {
    assert.equal(validateTitleDraft({ name: " " }).ok, false);
    assert.equal(validateTitleDraft("nope").ok, false);
    assert.equal(validateTitleDraft({}).ok, false);
  });

  it("caps the name at 120 characters", () => {
    const r = validateTitleDraft({ name: "a".repeat(200) });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.name.length, 120);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrateThreadRecord } from "../scripts/migrate-to-durable";

describe("durable migration", () => {
  it("preserves thread id", () => {
    assert.equal(migrateThreadRecord({ id: "thread_1", title: "Hi" }).id, "thread_1");
  });
});

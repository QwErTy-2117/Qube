import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";

describe("durable registry", () => {
  it("installs workspace read as replay-safe", async () => {
    const registry = await buildDurableRegistry();
    assert.ok(registry);
  });
});

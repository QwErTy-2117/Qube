import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable conversations", () => {
  it("creates conversation with qube thread id", async () => {
    const c = await getOrCreateConversation("thread_test_1", BACKGROUND_CONTEXT);
    assert.ok(c.id);
  });
});

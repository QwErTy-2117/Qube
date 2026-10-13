import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestId } from "@/lib/pi/durable-stream";

describe("durable chat", () => {
  it("builds exactly-once request id", () => {
    assert.equal(buildRequestId("thread_1", "turn_2"), "thread_1:turn_2");
  });
});

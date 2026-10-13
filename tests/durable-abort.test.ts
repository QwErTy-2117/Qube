import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approvalMemoKey } from "@/lib/pi/durable-registry";

describe("durable abort and approvals", () => {
  it("builds stable memo key", () => {
    assert.equal(approvalMemoKey("deploy", "abc"), "approval:deploy:abc");
  });
});

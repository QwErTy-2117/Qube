import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-appr-test-"));
import { denyApproval, grantApproval, keyFor, readApprovals } from "@/lib/pi/durable-approvals";
import { closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable approvals ledger", () => {
  it("grants, denies, and reads keys durably", async () => {
    const key = keyFor("delete_file", { path: "x" });
    assert.equal(key, 'approval:delete_file:{"path":"x"}');
    await grantApproval(key, BACKGROUND_CONTEXT);
    let snap = await readApprovals(BACKGROUND_CONTEXT);
    assert.ok(snap.allowed[key]);
    await denyApproval(key, BACKGROUND_CONTEXT);
    snap = await readApprovals(BACKGROUND_CONTEXT);
    assert.ok(snap.denied[key]);
    assert.ok(!snap.allowed[key]);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});

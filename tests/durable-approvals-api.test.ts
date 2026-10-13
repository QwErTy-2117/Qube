import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-appr-api-test-"));
import { GET, POST } from "../app/api/durable/approvals/route";
import { closeDurableHarness } from "@/lib/pi/durable";

function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/durable/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never);
}

describe("durable approvals API", () => {
  it("grants and lists an approval by tool+args", async () => {
    const res = await post({ tool: "delete_file", args: { path: "a.txt" }, decision: "allow" });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.decision, "allow");
    assert.match(payload.key, /^approval:delete_file:/);
    const list = await (await GET()).json();
    assert.ok(list.allowed.includes(payload.key));
  });

  it("denies and rejects bad decisions", async () => {
    const bad = await post({ tool: "delete_file", args: {}, decision: "maybe" });
    assert.equal(bad.status, 400);
    const deny = await post({ tool: "gmail_send_email", args: { to: "x" }, decision: "deny" });
    const payload = await deny.json();
    const list = await (await GET()).json();
    assert.ok(list.denied.includes(payload.key));
    await closeDurableHarness();
  });
});

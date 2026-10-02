/**
 * Connector identity regression tests (Windows production bug).
 *
 * Production builds embed ONE global COMPOSIO_API_KEY, so per-user
 * isolation depends entirely on distinct Composio userIds. Fresh installs
 * used to query as the shared "qube-default-user" and serve stale
 * connected:true — every fresh install showed connectors as connected.
 *
 * - resolveComposioUserId must never return the shared default; missing or
 *   default ids map to a stable per-device id (unique per machine).
 * - Real client UUIDs pass through untouched.
 * - Sensitive actions (delete_file anywhere, connector sends) pause for
 *   approval; read-only lookups never do.
 *
 * Run: npx tsx --test tests/connectors-identity.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_USER_ID,
  resolveComposioUserId,
} from "@/lib/connectors/composio";
import { evaluateToolCall } from "@/lib/middleware/permission-middleware";
import { getWorkspacePath } from "@/lib/middleware/workspace";

describe("composio user isolation (no global default)", () => {
  it("never returns the shared default id", () => {
    assert.notEqual(resolveComposioUserId(undefined), DEFAULT_USER_ID);
    assert.notEqual(resolveComposioUserId(null), DEFAULT_USER_ID);
    assert.notEqual(resolveComposioUserId(""), DEFAULT_USER_ID);
    assert.notEqual(resolveComposioUserId("qube-default-user"), DEFAULT_USER_ID);
    assert.notEqual(resolveComposioUserId("  qube-default-user  "), DEFAULT_USER_ID);
  });

  it("maps missing/default to a stable per-device id", () => {
    const a = resolveComposioUserId(undefined);
    const b = resolveComposioUserId("qube-default-user");
    const c = resolveComposioUserId("");
    assert.ok(a.length >= 8);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("passes real client UUIDs through untouched", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    assert.equal(resolveComposioUserId(uuid), uuid);
    assert.equal(resolveComposioUserId(`  ${uuid}  `), uuid);
  });
});

describe("sentinel approval gating (muse parity)", () => {
  const ws = getWorkspacePath();

  it("delete_file pauses even inside the workspace", () => {
    const r = evaluateToolCall("delete_file", { path: "documents/notes.md" }, ws);
    assert.equal(r.needsPermission, true);
    assert.match(r.description, /Delete file/i);
  });

  it("connector sends pause with a user-visible purpose", () => {
    const r = evaluateToolCall(
      "gmail_send_email",
      { to: "ana@test.com", subject: "Party" },
      ws,
    );
    assert.equal(r.needsPermission, true);
    assert.match(r.description, /Send email/i);
  });

  it("read-only connector lookups never pause", () => {
    for (const name of ["gmail_list_emails", "github_search_repos", "slack_list_channels"]) {
      const r = evaluateToolCall(name, {}, ws);
      assert.equal(r.needsPermission, false, `${name} should auto-allow`);
    }
  });

  it("read-only local tools never pause", () => {
    assert.equal(evaluateToolCall("read_file", { path: "documents/a.md" }, ws).needsPermission, false);
    assert.equal(evaluateToolCall("list_directory", { path: "." }, ws).needsPermission, false);
  });
});

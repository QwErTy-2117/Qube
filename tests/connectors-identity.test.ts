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
  __resetCanonicalCacheForTests,
} from "@/lib/connectors/composio";
import { evaluateToolCall } from "@/lib/middleware/permission-middleware";
import { shouldGateConnectorTool } from "@/lib/permissions/sensitive";
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

describe("canonical client id (background sees chat connections)", () => {
  it("remembers the client UUID so background runs resolve to it", () => {
    const clientUuid = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    assert.equal(resolveComposioUserId(clientUuid), clientUuid);
    // Background scheduler passes nothing — must land in the SAME namespace
    // the user connected accounts under, not a different device id.
    __resetCanonicalCacheForTests();
    assert.equal(resolveComposioUserId(undefined), clientUuid);
    assert.equal(resolveComposioUserId("qube-default-user"), clientUuid);
    assert.equal(resolveComposioUserId(""), clientUuid);
  });

  it("a new client UUID replaces the canonical one (last-writer-wins)", () => {
    const uuidA = `client-a-${Date.now().toString(36)}`;
    const uuidB = `client-b-${Date.now().toString(36)}`;
    assert.equal(resolveComposioUserId(uuidA), uuidA);
    __resetCanonicalCacheForTests();
    assert.equal(resolveComposioUserId(null), uuidA);
    assert.equal(resolveComposioUserId(uuidB), uuidB);
    __resetCanonicalCacheForTests();
    assert.equal(resolveComposioUserId(undefined), uuidB);
  });

  it("the shared default is never returned, even as canonical", () => {
    __resetCanonicalCacheForTests();
    assert.notEqual(resolveComposioUserId("qube-default-user"), DEFAULT_USER_ID);
  });
});

describe("headless connector gating (heartbeat drafts, scheduled tasks send)", () => {
  it("heartbeat gates sensitive connector tools to draft-only", () => {
    assert.equal(shouldGateConnectorTool("heartbeat", "gmail_send_email"), true);
    assert.equal(shouldGateConnectorTool("heartbeat", "slack_post_message"), true);
    assert.equal(shouldGateConnectorTool("heartbeat", "github_delete_issue"), true);
  });

  it("user-created scheduled tasks are NOT gated (instructions are the approval)", () => {
    assert.equal(shouldGateConnectorTool("scheduled", "gmail_send_email"), false);
    assert.equal(shouldGateConnectorTool("scheduled", "slack_post_message"), false);
    assert.equal(shouldGateConnectorTool("once", "gmail_send_email"), false);
  });

  it("read-only tools are never gated for any task type", () => {
    for (const type of ["heartbeat", "scheduled"]) {
      for (const name of ["gmail_list_emails", "github_search_repos", "list_directory"]) {
        assert.equal(shouldGateConnectorTool(type, name), false, `${type}/${name} should not gate`);
      }
    }
  });
});

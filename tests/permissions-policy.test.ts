import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { settingsStore } from "@/lib/settings-store";
import {
  checkActionPolicy,
  getPermissionSettings,
  isDestructiveAction,
} from "@/lib/permissions/policy";
import {
  withPermissionCheck,
  clearPendingPermissionsForHardReset,
  getPendingPermissions,
} from "@/lib/middleware/permission-middleware";

describe("Heartbeat and Task permission policy", () => {
  beforeEach(() => {
    settingsStore.resetForHardReset();
  });

  it("defaults to tools on, connectors on, destructive off, auto-approve off", () => {
    const settings = getPermissionSettings();
    assert.equal(settings.allowTools, true);
    assert.equal(settings.allowConnectors, true);
    assert.equal(settings.allowDestructive, false);
    assert.equal(settings.autoApprove, false);
  });

  it("hard-blocks disabled tool categories with no approval path", () => {
    settingsStore.update({ allowTools: false });
    const decision = checkActionPolicy("read_file", { path: "documents/a.md" }, "tool");
    assert.equal(decision.allowed, false);
    assert.match(decision.allowed === false ? decision.reason : "", /tools are turned off/i);
  });

  it("hard-blocks connector tools when connectors are off", () => {
    settingsStore.update({ allowConnectors: false });
    for (const name of ["gmail_list_emails", "gmail_send_email"]) {
      const decision = checkActionPolicy(name, {}, "connector");
      assert.equal(decision.allowed, false, name);
      assert.match(decision.allowed === false ? decision.reason : "", /connectors are turned off/i);
    }
  });

  it("blocks destructive actions unless explicitly enabled", () => {
    assert.equal(isDestructiveAction("delete_file", { path: "x" }), true);
    assert.equal(isDestructiveAction("run_command", { command: "rm -rf build" }), true);
    assert.equal(isDestructiveAction("gmail_send_email", {}), false);

    let decision = checkActionPolicy("delete_file", { path: "x" }, "tool");
    assert.equal(decision.allowed, false);
    assert.match(decision.allowed === false ? decision.reason : "", /destructive actions are turned off/i);

    settingsStore.update({ allowDestructiveActions: true });
    decision = checkActionPolicy("delete_file", { path: "x" }, "tool");
    assert.equal(decision.allowed, true);
  });

  it("auto-approve does not override hard limits", () => {
    settingsStore.update({ autoApproveActions: true, allowDestructiveActions: false });
    const decision = checkActionPolicy("delete_file", { path: "x" }, "tool");
    assert.equal(decision.allowed, false);
  });

  it("allows ordinary actions when categories are on", () => {
    settingsStore.update({ allowTools: true, allowConnectors: true });
    assert.equal(checkActionPolicy("read_file", { path: "documents/a.md" }, "tool").allowed, true);
    assert.equal(checkActionPolicy("gmail_list_emails", {}, "connector").allowed, true);
  });

  it("denies a disabled category before creating any approval request", async () => {
    settingsStore.update({ allowTools: false });
    clearPendingPermissionsForHardReset();
    let executed = false;
    const result = await withPermissionCheck(
      "read_file",
      { path: "documents/a.md" },
      "policy-test-thread",
      async () => {
        executed = true;
        return "read";
      },
    );
    assert.equal(executed, false);
    assert.match(result, /tools are turned off/i);
    assert.equal(getPendingPermissions("policy-test-thread").length, 0);
  });
});

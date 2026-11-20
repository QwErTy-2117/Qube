import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The desktop sidecar is a remote Tauri origin, so Tauri 2 requires an app
 * ACL permission before a custom command can be invoked from it. Without
 * `allow-finalize-hard-reset`, the server-side reset erases the data dir and
 * then the shell command is rejected, leaving Qube on a dead sidecar.
 */
describe("desktop hard reset ACL", () => {
  const root = process.cwd();

  it("grants finalize_hard_reset through the app permission manifest", () => {
    const permission = readFileSync(
      join(root, "src-tauri/permissions/app_commands.toml"),
      "utf8",
    );
    assert.match(permission, /identifier\s*=\s*"allow-finalize-hard-reset"/);
    assert.match(permission, /commands\.allow\s*=\s*\["finalize_hard_reset"\]/);
    assert.match(permission, /identifier\s*=\s*"allow-set-autostart"/);
    assert.match(permission, /commands\.allow\s*=\s*\["set_autostart"\]/);
    assert.match(permission, /identifier\s*=\s*"allow-get-port"/);
    assert.match(permission, /commands\.allow\s*=\s*\["get_port"\]/);
  });

  it("references the permission from the default capability", () => {
    const capability = JSON.parse(
      readFileSync(join(root, "src-tauri/capabilities/default.json"), "utf8"),
    ) as { permissions?: string[]; remote?: { urls?: string[] } };
    assert.ok(capability.permissions?.includes("allow-finalize-hard-reset"));
    assert.ok(capability.permissions?.includes("allow-set-autostart"));
    assert.ok(capability.permissions?.includes("allow-get-port"));
    assert.ok(capability.remote?.urls?.includes("http://127.0.0.1:*"));
    assert.ok(capability.remote?.urls?.includes("http://localhost:*"));
  });

  it("registers the command in the Tauri invoke handler", () => {
    const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
    assert.match(lib, /commands::finalize_hard_reset/);
  });

  it("invokes the command from the webview", () => {
    const client = readFileSync(join(root, "lib/system/client-reset.ts"), "utf8");
    assert.match(client, /invoke<boolean>\("finalize_hard_reset"\)/);
  });
});
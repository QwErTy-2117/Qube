import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertWorldReadable,
  normalizeSidecarPermissions,
} from "../scripts/sidecar-permissions.mjs";

/**
 * Regression guard for the v0.0.123 Linux startup failure: Playwright's
 * Chromium cache ships 0600 files (deb.deps/rpm.deps) and 0700 dirs
 * (extensions), and build-sidecar.js copied those modes into the bundle.
 * The app then could not copy its own sidecar to a temp dir as the user.
 */
const posix = process.platform !== "win32";

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qube-sidecar-perms-"));
  const nested = path.join(root, "browser", "chromium", "chrome-linux64");
  fs.mkdirSync(path.join(nested, "extensions"), { recursive: true });
  fs.writeFileSync(path.join(nested, "deb.deps"), "metadata");
  fs.writeFileSync(path.join(nested, "chrome"), "binary");
  const sandbox = path.join(nested, "chrome_sandbox");
  fs.writeFileSync(sandbox, "sandbox");

  let sandboxSetuid = false;
  if (posix) {
    fs.chmodSync(path.join(nested, "extensions"), 0o700);
    fs.chmodSync(path.join(nested, "deb.deps"), 0o600);
    fs.chmodSync(path.join(nested, "chrome"), 0o755);
    try {
      fs.chmodSync(sandbox, 0o4755);
      sandboxSetuid = (fs.statSync(sandbox).mode & 0o4000) !== 0;
    } catch {
      // Some filesystems disallow setuid; exec preservation still checked.
    }
  }
  return { root, nested, sandbox, sandboxSetuid };
}

describe("sidecar permissions (POSIX)", { skip: !posix }, () => {
  it("guard fails on private files and untraversable dirs before normalization", () => {
    const { root } = makeFixture();
    try {
      assert.throws(
        () => assertWorldReadable(root),
        (error: unknown) => {
          const message = String((error as Error).message);
          return message.includes("deb.deps") && message.includes("extensions");
        },
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalization makes the tree world-readable and keeps exec/setuid bits", () => {
    const { root, nested, sandbox, sandboxSetuid } = makeFixture();
    try {
      const result = normalizeSidecarPermissions(root);
      assert.equal(result.skipped, false);
      assert.ok(result.changed >= 2, `expected private entries to be fixed, got ${result.changed}`);

      assert.equal(fs.statSync(path.join(nested, "deb.deps")).mode & 0o777, 0o644);
      assert.equal(fs.statSync(path.join(nested, "extensions")).mode & 0o777, 0o755);
      assert.equal(fs.statSync(path.join(nested, "chrome")).mode & 0o777, 0o755);
      const sandboxMode = fs.statSync(sandbox).mode & 0o7777;
      assert.equal(sandboxMode & 0o111, 0o111);
      assert.equal(sandboxMode & 0o444, 0o444);
      if (sandboxSetuid) assert.equal(sandboxMode & 0o4000, 0o4000);

      assert.doesNotThrow(() => assertWorldReadable(root));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalization is idempotent", () => {
    const { root } = makeFixture();
    try {
      normalizeSidecarPermissions(root);
      const second = normalizeSidecarPermissions(root);
      assert.equal(second.changed, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

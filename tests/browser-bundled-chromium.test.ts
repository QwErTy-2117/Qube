import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { bundledChromiumCandidates } from "../lib/browser/managed-chrome";

/**
 * Locks the "no separate Chrome install" packaging contract: the sidecar
 * bundles Chromium under browser/chromium (scripts/build-sidecar.js) and
 * managed-chrome searches those exact paths first, per platform.
 */
describe("managed-chrome: bundled Chromium resolution", () => {
  it("linux: prefers chrome-linux64 then chrome-linux under the sidecar root", () => {
    const root = "/app/sidecar";
    const got = bundledChromiumCandidates(root, "linux");
    assert.deepEqual(got, [
      join(root, "browser", "chromium", "chrome-linux64", "chrome"),
      join(root, "browser", "chromium", "chrome-linux", "chrome"),
    ]);
  });

  it("windows: prefers chrome-win64 then chrome-win, .exe", () => {
    const root = "C:\\app\\sidecar";
    const got = bundledChromiumCandidates(root, "win32");
    assert.deepEqual(got, [
      join(root, "browser", "chromium", "chrome-win64", "chrome.exe"),
      join(root, "browser", "chromium", "chrome-win", "chrome.exe"),
    ]);
  });

  it("macOS: resolves the Chromium.app bundle binary", () => {
    const root = "/app/sidecar";
    const got = bundledChromiumCandidates(root, "darwin");
    assert.deepEqual(got, [
      join(root, "browser", "chromium", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ]);
  });

  it("every candidate lives under <root>/browser/chromium", () => {
    for (const plat of ["linux", "win32", "darwin"] as const) {
      for (const c of bundledChromiumCandidates("/root", plat)) {
        assert.ok(c.startsWith(join("/root", "browser", "chromium")), c);
      }
    }
  });
});
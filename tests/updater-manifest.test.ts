/**
 * Updater manifest tests — the platform keys in the release's latest.json.
 *
 * The updater endpoint is `releases/latest/download/latest.json`, so the
 * manifest of the newest release decides whether auto-update works at all
 * for every user. v0.0.89 shipped without the `linux-x86_64*` keys (the
 * matrix jobs raced on the shared manifest asset) and the Tauri updater
 * failed with:
 *   None of the fallback platforms `["linux-x86_64-rpm", "linux-x86_64"]`
 *   were found in the response `platforms` object
 * These tests lock the mapping that produces those keys.
 *
 * Run: npx tsx --test tests/updater-manifest.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bundlePlatform,
  mergeManifest,
  planPlatformKeys,
} from "../scripts/updater-manifest.mjs";
import type { BundleMeta } from "../scripts/updater-manifest.mjs";

// The bundle assets of a full release (Tauri's default names for the
// product "Qube", version 0.0.89).
const BUNDLES = [
  "Qube_0.0.89_aarch64.app.tar.gz",
  "Qube_0.0.89_aarch64.dmg",
  "Qube_0.0.89_x64.app.tar.gz",
  "Qube_0.0.89_x64.app.zip",
  "Qube_0.0.89_x64-setup.exe",
  "Qube_0.0.89_x64_en-US.msi",
  "Qube_0.0.89_arm64-setup.exe",
  "Qube_0.0.89_amd64.deb",
  "Qube_0.0.89_arm64.deb",
  "Qube-0.0.89-1.x86_64.rpm",
  "Qube-0.0.89-1.aarch64.rpm",
];

const metasOf = (names: string[]): BundleMeta[] =>
  names
    .map((name) => bundlePlatform(name))
    .filter((meta): meta is BundleMeta => meta !== null);

describe("bundlePlatform", () => {
  it("maps every updater bundle to its platform coordinates", () => {
    assert.deepEqual(bundlePlatform("Qube_0.0.89_amd64.deb"), {
      os: "linux",
      arch: "x86_64",
      bundle: "deb",
    });
    assert.deepEqual(bundlePlatform("Qube-0.0.89-1.x86_64.rpm"), {
      os: "linux",
      arch: "x86_64",
      bundle: "rpm",
    });
    assert.deepEqual(bundlePlatform("Qube_0.0.89_arm64.deb"), {
      os: "linux",
      arch: "aarch64",
      bundle: "deb",
    });
    assert.deepEqual(bundlePlatform("Qube-0.0.89-1.aarch64.rpm"), {
      os: "linux",
      arch: "aarch64",
      bundle: "rpm",
    });
    assert.deepEqual(bundlePlatform("Qube_0.0.89_x64-setup.exe"), {
      os: "windows",
      arch: "x86_64",
      bundle: "nsis",
    });
    assert.deepEqual(bundlePlatform("Qube_0.0.89_x64_en-US.msi"), {
      os: "windows",
      arch: "x86_64",
      bundle: "msi",
    });
    assert.deepEqual(bundlePlatform("Qube_0.0.89_arm64-setup.exe"), {
      os: "windows",
      arch: "aarch64",
      bundle: "nsis",
    });
    assert.deepEqual(bundlePlatform("Qube_0.0.89_aarch64.app.tar.gz"), {
      os: "darwin",
      arch: "aarch64",
      bundle: "app",
    });
    assert.deepEqual(bundlePlatform("Qube_0.0.89_x64.app.tar.gz"), {
      os: "darwin",
      arch: "x86_64",
      bundle: "app",
    });
  });

  it("ignores assets that are not updater artifacts", () => {
    assert.equal(bundlePlatform("Qube_0.0.89_aarch64.dmg"), null);
    assert.equal(bundlePlatform("Qube_0.0.89_x64.app.zip"), null);
    assert.equal(bundlePlatform("latest.json"), null);
    assert.equal(bundlePlatform("Qube_0.0.89_amd64.deb.sig"), null);
  });
});

describe("planPlatformKeys", () => {
  it("covers every platform of a full release", () => {
    const keys = [...planPlatformKeys(metasOf(BUNDLES)).keys()].sort();
    assert.deepEqual(keys, [
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "linux-aarch64",
      "linux-aarch64-deb",
      "linux-aarch64-rpm",
      "linux-x86_64",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-aarch64",
      "windows-aarch64-nsis",
      "windows-x86_64",
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ]);
  });

  it("points the plain {os}-{arch} key at the preferred bundle", () => {
    const planned = planPlatformKeys(metasOf(BUNDLES));
    // Linux -> deb, Windows -> NSIS (updaterJsonPreferNsis), macOS -> app.
    assert.equal(planned.get("linux-x86_64")?.bundle, "deb");
    assert.equal(planned.get("linux-aarch64")?.bundle, "deb");
    assert.equal(planned.get("windows-x86_64")?.bundle, "nsis");
    assert.equal(planned.get("windows-aarch64")?.bundle, "nsis");
    assert.equal(planned.get("darwin-aarch64")?.bundle, "app");
  });
});

describe("mergeManifest", () => {
  const entry = (id: number) => ({
    signature: "sig",
    url: `https://api.github.com/repos/o/r/releases/assets/${id}`,
  });

  it("fills in the platform entries the matrix race dropped", () => {
    // The v0.0.89 manifest as published: the linux-x86_64 keys were lost.
    const existing = {
      "darwin-aarch64": entry(1),
      "darwin-x86_64": entry(2),
      "windows-x86_64": entry(3),
      "linux-aarch64": entry(4),
    };
    const computed = new Map([
      ["linux-x86_64", entry(5)],
      ["linux-x86_64-deb", entry(5)],
      ["linux-x86_64-rpm", entry(6)],
      ["darwin-aarch64", entry(1)],
    ]);
    const { platforms, added, repaired, removed } = mergeManifest({
      existing,
      computed,
      liveAssetIds: new Set(["1", "2", "3", "4", "5", "6"]),
    });
    assert.deepEqual(added.sort(), [
      "linux-x86_64",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
    ]);
    assert.deepEqual(repaired, []);
    assert.deepEqual(removed, []);
    assert.equal(Object.keys(platforms).length, 7);
    // Existing entries are never rewritten.
    assert.deepEqual(platforms["darwin-aarch64"], existing["darwin-aarch64"]);
  });

  it("repairs an entry whose asset id no longer exists", () => {
    const existing = { "linux-x86_64": entry(99) };
    const computed = new Map([["linux-x86_64", entry(7)]]);
    const { platforms, added, repaired } = mergeManifest({
      existing,
      computed,
      liveAssetIds: new Set(["7"]),
    });
    assert.deepEqual(added, []);
    assert.deepEqual(repaired, ["linux-x86_64"]);
    assert.deepEqual(platforms["linux-x86_64"], entry(7));
  });

  it("leaves a complete manifest untouched", () => {
    const existing = { "linux-x86_64": entry(5) };
    const computed = new Map([["linux-x86_64", entry(6)]]);
    const { platforms, added, repaired, removed } = mergeManifest({
      existing,
      computed,
      liveAssetIds: new Set(["5", "6"]),
    });
    assert.deepEqual(added, []);
    assert.deepEqual(repaired, []);
    assert.deepEqual(removed, []);
    assert.deepEqual(platforms, existing);
  });
});

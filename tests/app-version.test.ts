/**
 * Version reporting tests.
 *
 * Settings used to read the version from the package.json inside the sidecar
 * temp copy. That copy can lag behind the installed binary (it is refreshed by
 * the delta logic in src-tauri/src/sidecar.rs), so an app that had genuinely
 * updated kept displaying the previous release while the updater — which reads
 * the binary version — correctly reported "up to date".
 *
 * Run: npx tsx --test tests/app-version.test.ts (or `npm test`)
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";
import { getAppVersion } from "@/lib/app-version";

describe("getAppVersion", () => {
  const original = process.env.QUBE_APP_VERSION;

  afterEach(() => {
    if (original === undefined) delete process.env.QUBE_APP_VERSION;
    else process.env.QUBE_APP_VERSION = original;
  });

  it("prefers the desktop shell version over the sidecar package.json", () => {
    process.env.QUBE_APP_VERSION = "0.0.142";
    assert.equal(getAppVersion(), "0.0.142");
  });

  it("trims whitespace and ignores an empty value", () => {
    process.env.QUBE_APP_VERSION = "  0.0.142\n";
    assert.equal(getAppVersion(), "0.0.142");
    process.env.QUBE_APP_VERSION = "   ";
    assert.equal(getAppVersion(), packageJson.version);
  });

  it("falls back to package.json outside the desktop shell", () => {
    delete process.env.QUBE_APP_VERSION;
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    assert.equal(getAppVersion(), pkg.version);
  });
});

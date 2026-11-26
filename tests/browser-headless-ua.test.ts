import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildChromeLaunchArgs,
  headlessUserAgent,
  parseChromeMajorVersion,
} from "../lib/browser/managed-chrome";

/**
 * Cloudflare's managed challenge rejects Chrome's default "HeadlessChrome"
 * User-Agent and loops on "Just a moment…" forever. Qube now rewrites the UA
 * to a normal desktop Chrome UA of the same major version in headless mode.
 * These tests lock that behavior and the absence of automation flags.
 */
describe("managed-chrome: headless User-Agent", () => {
  it("parses the major version from Chrome, Chromium and Edge --version output", () => {
    assert.equal(parseChromeMajorVersion("Google Chrome for Testing 149.0.7827.55"), 149);
    assert.equal(parseChromeMajorVersion("Chromium 149.0.7827.55"), 149);
    assert.equal(parseChromeMajorVersion("Microsoft Edge 149.0.7827.55"), 149);
    assert.equal(parseChromeMajorVersion("149.0.7827.55"), 149);
    assert.equal(parseChromeMajorVersion(""), null);
    assert.equal(parseChromeMajorVersion("not a version"), null);
  });

  it("never emits the HeadlessChrome token and keeps the real major version", () => {
    for (const [plat, arch] of [
      ["linux", "x64"],
      ["linux", "arm64"],
      ["win32", "x64"],
      ["darwin", "arm64"],
    ] as const) {
      const ua = headlessUserAgent(plat, arch, 149);
      assert.ok(!/Headless/i.test(ua), ua);
      assert.match(ua, /Chrome\/149\.0\.0\.0 Safari\/537\.36/);
    }
  });

  it("uses the native platform token for each OS", () => {
    assert.match(headlessUserAgent("linux", "x64", 149), /\(X11; Linux x86_64\)/);
    assert.match(headlessUserAgent("linux", "arm64", 149), /\(X11; Linux aarch64\)/);
    assert.match(headlessUserAgent("win32", "arm64", 149), /\(Windows NT 10\.0; Win64; x64\)/);
    assert.match(headlessUserAgent("darwin", "arm64", 149), /\(Macintosh; Intel Mac OS X 10_15_7\)/);
  });

  it("passes the normal UA in headless mode", () => {
    const ua = headlessUserAgent("linux", "x64", 149);
    const args = buildChromeLaunchArgs({
      port: 9222,
      profileDir: "/tmp/profile",
      headed: false,
      headlessUa: ua,
    });
    assert.ok(args.includes("--headless=new"), args.join(" "));
    assert.ok(args.includes(`--user-agent=${ua}`), args.join(" "));
    assert.ok(!args.includes("--enable-automation"), "must not set navigator.webdriver");
  });

  it("keeps the native UA when headed", () => {
    const args = buildChromeLaunchArgs({
      port: 9222,
      profileDir: "/tmp/profile",
      headed: true,
      headlessUa: headlessUserAgent("linux", "x64", 149),
    });
    assert.ok(!args.some((a) => a.startsWith("--headless")), args.join(" "));
    assert.ok(!args.some((a) => a.startsWith("--user-agent=")), args.join(" "));
    assert.ok(args.includes("--start-maximized"), args.join(" "));
  });
});

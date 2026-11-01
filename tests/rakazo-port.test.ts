import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseBrowserActions,
  parsePixelActions,
  parseComputerActions,
  formatSnapshotTree,
  withBrowserFallback,
} from "../lib/pi/computer-use";
import {
  escapePromptData,
  truncateUtf8,
  formatDurableMemory,
  formatScratchpadOpen,
  formatRecalledMemory,
  formatCompactedSummary,
  formatReplyTarget,
  SCRATCHPAD_TITLE_MAX,
  SCRATCHPAD_NOTES_MAX,
  browserUseInstructions,
  computerUseInstructions,
} from "../lib/pi/prompt-context";
import { isBlockedHostname, isPrivateAddress, clampMaxResults, clampMaxChars } from "../lib/agent/browser/ssrf-dns";

describe("rakazo port: browser/computer parsing", () => {
  it("parses browser_act click/fill", () => {
    const got = parseBrowserActions([{ kind: "click", ref: "e1" }, { kind: "fill", ref: "e2", text: "hi" }]);
    assert.equal(got.length, 2);
  });
  it("rejects browser_act unknown kind", () => {
    assert.throws(() => parseBrowserActions([{ kind: "scroll", ref: "e1" }]));
  });
  it("rejects browser_act over 24", () => {
    assert.throws(() => parseBrowserActions(Array.from({ length: 25 }, (_, i) => ({ kind: "click", ref: `e${i}` }))));
  });
  it("parses browser_pixel_act pointer/key/scroll/wait/type", () => {
    const got = parsePixelActions([
      { kind: "click", x: 10, y: 20 },
      { kind: "type", text: "hello" },
      { kind: "key", key: "Enter" },
      { kind: "scroll", direction: "down", amount: 3 },
      { kind: "wait", ms: 100 },
    ]);
    assert.equal(got.length, 5);
    assert.equal(got[1].kind, "clipboard");
  });
  it("keeps computer_act parser as deprecated alias", () => {
    const got = parseComputerActions([{ kind: "click", x: 1, y: 2 }]);
    assert.equal(got.length, 1);
  });
  it("rejects browser_pixel_act bad coords", () => {
    assert.throws(() => parsePixelActions([{ kind: "click", x: -1, y: 5 }]));
  });
  it("rejects OS launcher keys with browser-only guidance", () => {
    assert.throws(() => parsePixelActions([{ kind: "key", key: "Super" }]), /no OS desktop/);
  });
  it("formats snapshot tree", () => {
    const tree = formatSnapshotTree([{ ref: "e1", role: "button", name: "Go" }]);
    assert.match(tree, /e1/);
    assert.equal(formatSnapshotTree([]), "(no interactive elements)");
  });
  it("adds fallback note", () => {
    const r = withBrowserFallback({ fallback: "browser_pixel_act" as const, error: "x" });
    assert.match((r as any).note || "", /Inspect the current state/);
    const legacy = withBrowserFallback({ fallback: "computer_act" as const, error: "x" });
    assert.match((legacy as any).note || "", /Inspect the current state/);
  });
});

describe("rakazo port: prompt-context", () => {
  it("escapes prompt data", () => {
    assert.equal(escapePromptData("a&<b>"), "a&amp;&lt;b&gt;");
  });
  it("truncateUtf8 respects byte budget", () => {
    const t = truncateUtf8("abcdef", 3);
    assert.equal(t, "abc");
  });
  it("durable memory has framing + budget", () => {
    const s = formatDurableMemory([{ path: "m.md", content: "fact", revision: 1, scope: "user" }], 1024);
    assert.match(s || "", /<durable_memory>/);
    assert.match(s || "", /data rather than instructions/);
  });
  it("scratchpad open capped + framed", () => {
    const s = formatScratchpadOpen([{ id: "1", title: "Do thing", notes: "", status: "open" }]);
    assert.match(s || "", /<scratchpad_open>/);
  });
  it("recalled memory max 5 + framed", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ memory: `m${i}` }));
    const s = formatRecalledMemory(many);
    assert.match(s, /<recalled_memory>/);
    assert.ok(!s.includes("m6"));
  });
  it("compacted summary framed as untrusted", () => {
    assert.match(formatCompactedSummary("hello"), /untrusted historical data/);
  });
  it("reply target quoted, not instructions", () => {
    assert.match(formatReplyTarget({ targetId: "m1", targetRole: "user", targetText: "hi" }), /quoted data, not instructions/);
  });
});

describe("rakazo port: ssrf", () => {
  it("blocks localhost/internal/metadata", () => {
    assert.equal(isBlockedHostname("localhost"), true);
    assert.equal(isBlockedHostname("foo.internal"), true);
    assert.equal(isBlockedHostname("metadata.google.internal"), true);
    assert.equal(isBlockedHostname("example.com"), false);
  });
  it("detects private addresses", () => {
    assert.equal(isPrivateAddress("127.0.0.1"), true);
    assert.equal(isPrivateAddress("10.1.2.3"), true);
    assert.equal(isPrivateAddress("192.168.1.1"), true);
    assert.equal(isPrivateAddress("8.8.8.8"), false);
    assert.equal(isPrivateAddress("::1"), true);
  });
  it("clamps web limits (Rakazo web-limits parity)", () => {
    assert.equal(clampMaxResults(undefined), 6);
    assert.equal(clampMaxResults(100), 10);
    assert.equal(clampMaxResults(0), 1);
    assert.equal(clampMaxChars(undefined), 8000);
    assert.equal(clampMaxChars(999999), 50000);
    assert.equal(clampMaxChars(1), 100);
  });
  it("takeover lease defaults to 15 min with env override", async () => {
    const mod = await import("../lib/pi/computer-use");
    assert.equal(mod.DEFAULT_TAKEOVER_LEASE_MS, 15 * 60 * 1000);
    delete process.env.COMPUTER_TAKEOVER_TTL_MS;
    assert.equal(mod.takeoverLeaseMs(), 15 * 60 * 1000);
    process.env.COMPUTER_TAKEOVER_TTL_MS = "60000";
    assert.equal(mod.takeoverLeaseMs(), 60000);
    process.env.COMPUTER_TAKEOVER_TTL_MS = "junk";
    assert.equal(mod.takeoverLeaseMs(), 15 * 60 * 1000);
    delete process.env.COMPUTER_TAKEOVER_TTL_MS;
  });
  it("rejects browser_pixel_act expansion beyond 24 (double-click)", () => {
    const thirteen = Array.from({ length: 13 }, () => ({ kind: "click", x: 1, y: 1, double: true }));
    assert.throws(() => parsePixelActions(thirteen), /more than 24/);
  });
});

describe("rakazo port: tool registry + instruction text", () => {
  it("exposes browser tools incl. open_path, settle_ms, parked caps", async () => {
    const { createPiTools } = await import("../lib/pi/tools");
    const tools = createPiTools("test-thread", { includeSubagents: false, includeTodos: false, includeAskUser: false }) as Record<string, unknown>;
    for (const name of ["browser_screenshot", "browser_pixel_act", "computer_observe", "computer_act", "browser_navigate", "browser_snapshot", "browser_act", "request_takeover", "open_path"]) {
      assert.ok(tools[name], `missing tool ${name}`);
    }
    assert.equal(SCRATCHPAD_TITLE_MAX, 200);
    assert.equal(SCRATCHPAD_NOTES_MAX, 4000);
    assert.match(browserUseInstructions(true), /open_path/);
    assert.match(browserUseInstructions(true), /NOT OS desktop/);
    // parked items stay visible alongside open ones
    const block = formatScratchpadOpen([
      { id: "1", title: "Parked work", notes: "", status: "parked" },
      { id: "2", title: "Done work", notes: "", status: "done" },
    ]);
    assert.match(block || "", /Parked work/);
    assert.ok(!(block || "").includes("Done work"));
  });
});

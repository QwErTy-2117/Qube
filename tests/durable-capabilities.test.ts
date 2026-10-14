/**
 * Durable MCP capabilities run through the computer-use kernel.
 *
 * The durable guard hook does not cover MCP tools, so without the kernel
 * wrapper the built-in browser surface (navigate/act/tabs/…) would execute
 * with no repeat-guard, no risk gating, no verification, and no audit log.
 * These tests load the REAL default MCP stack (built-in auto-mcp server,
 * no browser needed for the assertions below) and prove the pipeline.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/durable-capabilities.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { defaultCapabilityLoaders } from "@/lib/pi/durable-capabilities";

describe("durable MCP capabilities go through the kernel", () => {
  it("loads the built-in browser tools", async () => {
    const loaders = defaultCapabilityLoaders("durable-cap-test-list");
    const mcp = loaders.mcp;
    assert.ok(mcp);
    const { tools, cleanup } = await mcp();
    try {
      assert.ok(tools.navigate, "missing MCP navigate");
      assert.ok(tools.act, "missing MCP act");
      assert.ok(tools.tabs, "missing MCP tabs");
    } finally {
      await cleanup?.();
    }
  });

  it("denies risky headless browser actions instead of executing them", async () => {
    const loaders = defaultCapabilityLoaders("durable-cap-test-deny");
    const mcp = loaders.mcp;
    assert.ok(mcp);
    const { tools, cleanup } = await mcp();
    try {
      // No browser needed: "Buy now" typed text classifies as financial, and
      // headless runs deny above interact before any CDP call happens.
      const out = (await (tools.act as any).execute(
        { actions: [{ kind: "type", ref: "e1", text: "Buy now" }] },
        {},
      )) as unknown;
      const parsed = typeof out === "string" ? JSON.parse(out) : out;
      const text = typeof parsed === "string"
        ? parsed
        : JSON.stringify(parsed);
      assert.match(text, /not permitted|headless/i);
    } finally {
      await cleanup?.();
    }
  });
});

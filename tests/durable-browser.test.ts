import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBrowserExtension, resetDurableBrowserForTests } from "@/lib/pi/durable-browser";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";

describe("durable browser extension", () => {
  it("exposes the kernel-backed browser tools", () => {
    resetDurableBrowserForTests();
    const ext = buildBrowserExtension() as unknown as { name: string; tools: Array<{ name: string }> };
    assert.equal(ext.name, "browser");
    const names = ext.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "browser_act",
      "browser_navigate",
      "browser_pixel_act",
      "browser_screenshot",
      "browser_snapshot",
      "computer_clipboard_read",
      "computer_clipboard_write",
      "dev_server",
      "dev_server_log",
      "open_path",
      "request_takeover",
    ]);
  });
  it("installs into the durable registry", async () => {
    resetDurableBrowserForTests();
    const registry = await buildDurableRegistry();
    assert.ok(registry);
  });
  it("delegates takeover and clipboard tools to the kernel pipeline", async () => {
    resetDurableBrowserForTests();
    const ext = buildBrowserExtension() as unknown as {
      tools: Array<{ name: string; execute: (args: unknown, api: unknown) => Promise<{ output: Array<{ text?: string }> }> }>;
    };
    const byName = new Map(ext.tools.map((t) => [t.name, t]));
    const textOf = async (name: string, args: unknown) => {
      const t = byName.get(name);
      assert.ok(t, `missing durable tool ${name}`);
      const res = await t.execute(args, { taskId: `test-durable-${name}` });
      return res.output?.[0]?.text ?? "";
    };
    // Headless: takeover honestly reports no interactive user instead of hanging.
    const takeover = JSON.parse(await textOf("request_takeover", { reason: "captcha" }));
    assert.equal(takeover.queued, false);
    // Clipboard read always resolves to JSON (text or unavailable error).
    const clip = JSON.parse(await textOf("computer_clipboard_read", {}));
    assert.equal(clip.tool, "computer_clipboard_read");
    // Clipboard write is refused on headless runs, not executed.
    const written = JSON.parse(await textOf("computer_clipboard_write", { text: "hi" }));
    assert.equal(written.error, true);
    resetDurableBrowserForTests();
  });
});

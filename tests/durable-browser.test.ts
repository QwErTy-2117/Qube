import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBrowserExtension, resetDurableBrowserForTests } from "@/lib/pi/durable-browser";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";

describe("durable browser extension", () => {
  it("exposes the kernel-backed browser tools", () => {
    resetDurableBrowserForTests();
    const ext = buildBrowserExtension() as { name: string; tools: Array<{ name: string }> };
    assert.equal(ext.name, "browser");
    const names = ext.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "browser_act",
      "browser_navigate",
      "browser_pixel_act",
      "browser_screenshot",
      "browser_snapshot",
      "dev_server",
      "dev_server_log",
      "open_path",
    ]);
  });
  it("installs into the durable registry", async () => {
    resetDurableBrowserForTests();
    const registry = await buildDurableRegistry();
    assert.ok(registry);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-durable-browser-test-"));
import {
  buildBrowserExtension,
  resetDurableBrowserForTests,
  setBrowserTurnContext,
  resolveBrowserThread,
} from "@/lib/pi/durable-browser";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";
import { StateTracker } from "@/lib/computer-use/state";

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
describe("durable browser turn context", () => {
  it("falls back to the per-call taskId, headless, without a conversation", async () => {
    resetDurableBrowserForTests();
    assert.deepEqual(await resolveBrowserThread({ taskId: "call-1" }), { threadId: "call-1", interactive: false });
    assert.deepEqual(await resolveBrowserThread({}), { threadId: "durable", interactive: false });
    setBrowserTurnContext("call-1", { interactive: true });
    // Fallback path never consults turn contexts (it has no thread to map).
    assert.deepEqual(await resolveBrowserThread({ taskId: "call-1" }), { threadId: "call-1", interactive: false });
    resetDurableBrowserForTests();
  });

  it("routes tool calls to the chat thread and honors foreground interactivity", async () => {
    resetDurableBrowserForTests();
    StateTracker.resetForTests();
    const { getOrCreateConversation, ThreadMap } = await import("@/lib/pi/durable-conversations");
    const { getDurableHarness, closeDurableHarness } = await import("@/lib/pi/durable");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const prevTimeout = process.env.PERMISSION_TIMEOUT_MS;
    process.env.PERMISSION_TIMEOUT_MS = "50";
    try {
      const thread = `durable-ctx-${Date.now()}`;
      await getOrCreateConversation(thread, BACKGROUND_CONTEXT);
      const h = await getDurableHarness(BACKGROUND_CONTEXT);
      const snap = await h.snapshot(ThreadMap, BACKGROUND_CONTEXT);
      const convId = (snap as any)?.ids?.[thread] as string | undefined;
      assert.ok(convId, "thread should map to a conversation");
      setBrowserTurnContext(thread, { interactive: true });

      const ext = buildBrowserExtension() as unknown as {
        tools: Array<{ name: string; execute: (args: unknown, api: unknown) => Promise<{ output: Array<{ text?: string }> }> }>;
      };
      const byName = new Map(ext.tools.map((t) => [t.name, t]));
      const api = { taskId: "probe-call", conversationId: convId };

      // Observe-only snapshot records history under the CHAT thread, not the call id.
      const snapshot = byName.get("browser_snapshot");
      assert.ok(snapshot);
      await snapshot.execute({}, api);
      const tracked = StateTracker.forThread(thread);
      assert.ok(tracked.history.some((r) => r.tool === "browser_snapshot"), "kernel state should live on the chat thread");
      assert.equal(StateTracker.forThread("probe-call").history.length, 0);

      // Foreground + financial action asks (then times out fast) instead of
      // headless-denying: approval path, not refusal path. Ref e999 resolves
      // nowhere (live browser or not), so the typed value drives risk and no
      // real element is ever touched.
      const act = byName.get("browser_act");
      assert.ok(act);
      const res = await act.execute({ actions: [{ kind: "type", ref: "e999", text: "Buy now" }] }, api);
      const text = res.output?.[0]?.text ?? "";
      assert.match(text, /did not approve|not permitted/i);
      assert.doesNotMatch(text, /Headless\/background runs cannot perform/);
    } finally {
      if (prevTimeout === undefined) delete process.env.PERMISSION_TIMEOUT_MS;
      else process.env.PERMISSION_TIMEOUT_MS = prevTimeout;
      try {
        const { closeDurableHarness } = await import("@/lib/pi/durable");
        await closeDurableHarness(BACKGROUND_CONTEXT);
      } catch {}
      resetDurableBrowserForTests();
      StateTracker.resetForTests();
    }
  });
});

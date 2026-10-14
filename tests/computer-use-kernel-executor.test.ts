import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyKernel } from "../lib/computer-use/index";

function strTool(impl: (args: any) => Promise<string> | string) {
  return { description: "t", inputSchema: {} as any, execute: async (args: any) => impl(args) };
}

describe("kernel executor", () => {
  it("passes through non-kernel tools untouched", () => {
    const tools = { TodoWrite: strTool(async () => "ok") };
    const out = applyKernel(tools, { threadId: "t1", interactive: true });
    assert.equal(out.TodoWrite, tools.TodoWrite);
  });
  it("verifies a click that changes the page", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true, completed: 1 })) };
    const fps = [
      { at: 1, url: "https://x.com/", title: "t", textHash: "h1", textLen: 5, dialog: false },
      { at: 2, url: "https://x.com/next", title: "t", textHash: "h2", textLen: 9, dialog: false },
    ];
    const out = applyKernel(tools, { threadId: "t2", interactive: true, probePage: async () => fps.shift() ?? fps[0] });
    const raw = await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] });
    const p = JSON.parse(String(raw));
    assert.equal(p._kernel.verdict, "verified");
    assert.equal(p._kernel.changed, true);
  });
  it("asks approval for financial actions and denies on refusal", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true })) };
    const out = applyKernel(tools, {
      threadId: "t3", interactive: true,
      askApproval: async () => false,
      resolveLabel: async (ref) => (ref === "e9" ? "Place order" : null),
    });
    const raw = await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e9" }] });
    assert.match(String(raw), /not permitted/i);
  });
  it("denies risky actions when headless", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true })) };
    const out = applyKernel(tools, {
      threadId: "t4", interactive: false,
      resolveLabel: async () => "Delete account",
    });
    const raw = await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] });
    assert.match(String(raw), /headless|not permitted/i);
  });
  it("blocks a repeated failed action", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ error: "Stale ref e1: page re-rendered" })) };
    const out = applyKernel(tools, { threadId: "t5", interactive: true });
    const args = { actions: [{ kind: "click", ref: "e1" }] };
    await (out.browser_act as any).execute(args);
    await (out.browser_act as any).execute(args);
    const third = String(await (out.browser_act as any).execute(args));
    assert.match(third, /repeat_failure/);
  });
  it("warns explicitly on the second identical failure before blocking", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    const tools = { browser_act: strTool(async () => JSON.stringify({ error: "Stale ref e1: gone" })) };
    const out = applyKernel(tools, { threadId: "t9", interactive: true });
    const args = { actions: [{ kind: "click", ref: "e1" }] };
    const first = JSON.parse(String(await (out.browser_act as any).execute(args)));
    assert.equal(first._kernel.repeat, undefined);
    const second = JSON.parse(String(await (out.browser_act as any).execute(args)));
    assert.equal(second._kernel.repeat, true);
    assert.ok((second._kernel.hints || []).join(" ").includes("Final warning"));
    const third = String(await (out.browser_act as any).execute(args));
    assert.match(third, /repeat_failure/);
    StateTracker.resetForTests();
  });
  it("fails open when the probe throws", async () => {
    const tools = { browser_snapshot: strTool(async () => JSON.stringify({ url: "https://x.com/", tree: "" })) };
    const out = applyKernel(tools, { threadId: "t6", interactive: true, probePage: async () => { throw new Error("cdp dead"); } });
    const raw = String(await (out.browser_snapshot as any).execute({}));
    assert.ok(raw.includes("https://x.com/"));
  });
  it("records a checkpoint on verified navigation", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    const tools = { browser_navigate: strTool(async () => JSON.stringify({ url: "https://x.com/shop", title: "Shop" })) };
    const fps = [
      { at: 1, url: "https://x.com/", title: "t", textHash: "h1", textLen: 5, dialog: false },
      { at: 2, url: "https://x.com/shop", title: "Shop", textHash: "h2", textLen: 9, dialog: false },
    ];
    const out = applyKernel(tools, { threadId: "t7", interactive: true, probePage: async () => fps.shift() ?? fps[0] });
    const raw = await (out.browser_navigate as any).execute({ url: "https://x.com/shop" });
    const p = JSON.parse(String(raw));
    assert.equal(p._kernel.verdict, "verified");
    const state = StateTracker.forThread("t7");
    assert.equal(state.checkpoints.length, 1);
    assert.match(state.checkpoints[0].label, /x.com\/shop/);
    assert.match(state.resumeContext(), /Confirmed checkpoints/);
    StateTracker.resetForTests();
  });
  it("catalogs clipboard tools as desktop observe/interact", async () => {
    const { describeAction } = await import("../lib/computer-use/catalog");
    const r = describeAction("computer_clipboard_read", {});
    assert.equal(r.domain, "desktop");
    assert.equal(r.kind, "observe");
    assert.equal(r.mutating, false);
    const w = describeAction("computer_clipboard_write", { text: "hi" });
    assert.equal(w.domain, "desktop");
    assert.equal(w.mutating, true);
  });
  it("executes resnapshot recovery on stale refs and refreshes state", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    const tools = { browser_act: strTool(async () => JSON.stringify({ error: "Stale ref e1: page re-rendered" })) };
    const fp = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const fresh = { ...fp, at: 2, textHash: "h2" };
    let probes = 0;
    const out = applyKernel(tools, {
      threadId: "t8", interactive: true,
      probePage: async () => { probes++; return probes <= 2 ? fp : fresh; },
    });
    const raw = String(await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] }));
    const p = JSON.parse(raw);
    assert.equal(p._kernel.verdict, "failed");
    assert.deepEqual(p._kernel.recovered, ["resnapshot"]);
    assert.equal(probes, 3);
    assert.equal(StateTracker.forThread("t8").lastFingerprint?.textHash, "h2");
    StateTracker.resetForTests();
  });
});

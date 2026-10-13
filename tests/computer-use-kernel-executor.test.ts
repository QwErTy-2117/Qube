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
  it("fails open when the probe throws", async () => {
    const tools = { browser_snapshot: strTool(async () => JSON.stringify({ url: "https://x.com/", tree: "" })) };
    const out = applyKernel(tools, { threadId: "t6", interactive: true, probePage: async () => { throw new Error("cdp dead"); } });
    const raw = String(await (out.browser_snapshot as any).execute({}));
    assert.ok(raw.includes("https://x.com/"));
  });
});

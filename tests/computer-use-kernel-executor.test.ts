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
  it("resolves ref labels concurrently, not one by one", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true })) };
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const labels: Record<string, string> = { e1: 'link "A"', e2: 'button "Place order"', e3: 'link "C"' };
    const out = applyKernel(tools, {
      threadId: "t10", interactive: true,
      askApproval: async () => false,
      resolveLabel: async (ref) => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await new Promise((r) => setTimeout(r, 25));
          return labels[ref] ?? null;
        } finally {
          inFlight--;
        }
      },
    });
    const raw = String(await (out.browser_act as any).execute({ actions: [
      { kind: "click", ref: "e1" },
      { kind: "click", ref: "e2" },
      { kind: "click", ref: "e3" },
    ] }));
    assert.equal(calls, 3);
    assert.equal(maxInFlight, 3);
    // Highest-risk label ("Place order" → financial) drove the decision.
    assert.match(raw, /not permitted/i);
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
  it("ignores cached labels from a different page", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    // Seed cache: e1 was "Place order" on page A.
    StateTracker.forThread("t11").noteRefs("https://a.com/", [{ ref: "e1", role: "button", name: "Place order" }]);
    const fpB = { at: 1, url: "https://b.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    let asked = 0;
    let resolved = 0;
    const out = applyKernel(
      { browser_act: strTool(async () => JSON.stringify({ ok: true })) },
      {
        threadId: "t11", interactive: true,
        probePage: async () => fpB,
        resolveLabel: async () => { resolved++; return null; },
        askApproval: async () => { asked++; return true; },
      },
    );
    const raw = String(await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] }));
    JSON.parse(raw);
    // Stale "Place order" must NOT trigger approval on page B; live DOM
    // resolution was attempted instead.
    assert.equal(asked, 0);
    assert.equal(resolved, 1);
    // Control: same-page cache still gates without live resolution.
    StateTracker.forThread("t12").noteRefs("https://b.com/", [{ ref: "e1", role: "button", name: "Place order" }]);
    let asked2 = 0;
    const out2 = applyKernel(
      { browser_act: strTool(async () => JSON.stringify({ ok: true })) },
      {
        threadId: "t12", interactive: true,
        probePage: async () => fpB,
        resolveLabel: async () => { throw new Error("should use cache"); },
        askApproval: async () => { asked2++; return false; },
      },
    );
    const raw2 = String(await (out2.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] }));
    assert.match(raw2, /not permitted/i);
    assert.equal(asked2, 1);
    StateTracker.resetForTests();
  });
  it("attaches page console/network error details to _kernel", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    const errObs = {
      at: 2, url: "https://x.com/app", title: "t", textHash: "h2", textLen: 9, dialog: false,
      consoleErrors: [{ type: "error", text: "Uncaught TypeError: boom", url: "https://x.com/app.js", line: 7 }],
      networkFailures: [{ url: "https://x.com/api", errorText: "HTTP 500", status: 500 }],
    };
    const pre = { at: 1, url: "https://x.com/app", title: "t", textHash: "h1", textLen: 5, dialog: false };
    let n = 0;
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true, completed: 1 })) };
    const out = applyKernel(tools, {
      threadId: "t14", interactive: true,
      probePage: async () => { n++; return n === 1 ? pre : errObs as any; },
    });
    const raw = String(await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] }));
    const p = JSON.parse(raw);
    assert.ok((p._kernel.signals || []).includes("console_errors"));
    assert.ok((p._kernel.signals || []).includes("network_errors"));
    assert.equal(p._kernel.pageErrors.length, 2);
    assert.match(p._kernel.pageErrors.join("\n"), /boom/);
    assert.match(p._kernel.pageErrors.join("\n"), /HTTP 500/);
    StateTracker.resetForTests();
  });
  it("fails fast on disabled targets without executing", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    let executed = 0;
    let approved = 0;
    const tools = { browser_act: strTool(async () => { executed++; return JSON.stringify({ ok: true }); }) };
    const out = applyKernel(tools, {
      threadId: "t13", interactive: true,
      probePage: async () => ({ at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false }),
      describeRef: async (ref) => ({ label: 'button "Pay"', disabled: ref === "e2", visible: true }),
      askApproval: async () => { approved++; return true; },
    });
    const raw = String(await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e2" }] }));
    const p = JSON.parse(raw);
    // Doomed action never ran and never prompted — reported as disabled.
    assert.equal(executed, 0);
    assert.equal(approved, 0);
    assert.equal(p._kernel.verdict, "failed");
    assert.ok(p._kernel.signals.includes("disabled"));
    assert.ok((p._kernel.hints || []).join(" ").match(/prereq|required|disabled/i));
    StateTracker.resetForTests();
  });
  it("tracks the tab roster from tab-tool results", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    const tools = {
      tabs: strTool(async () => JSON.stringify([
        { id: "a", url: "https://a.com/", title: "A" },
        { id: "b", url: "https://b.com/x", title: "B" },
      ])),
      close_tab: strTool(async () => "Closed tab a (https://a.com/)"),
    };
    const out = applyKernel(tools, { threadId: "t15", interactive: true });
    await (out.tabs as any).execute({});
    assert.equal(StateTracker.forThread("t15").tabs.length, 2);
    assert.match(StateTracker.forThread("t15").resumeContext(), /Open tabs \(2\)/);
    await (out.close_tab as any).execute({ tab_id: 1 });
    const rest = StateTracker.forThread("t15").tabs;
    assert.equal(rest.length, 1);
    assert.equal(rest[0].id, "b");
    // Roster ignores garbage and survives persist/restore.
    const st = StateTracker.forThread("t15");
    st.noteTabs([{ url: "" }, null, { id: "c", url: "https://c.com/" } as any]);
    assert.equal(st.tabs.length, 1);
    st.noteTabOpened({ id: "c", url: "https://c.com/", title: "C" });
    st.noteTabOpened({ id: "c", url: "https://c.com/", title: "C" });
    assert.equal(st.tabs.filter((t) => t.id === "c").length, 1);
    st.persist("t15");
    StateTracker.resetForTests();
    assert.ok(StateTracker.forThread("t15").tabs.some((t) => t.id === "c"));
    StateTracker.resetForTests();
  });
  it("steers flailing runs to replan instead of maneuver", async () => {
    const { StateTracker } = await import("../lib/computer-use/state");
    StateTracker.resetForTests();
    const tools = { browser_act: strTool(async () => JSON.stringify({ error: "Stale ref vanished mid-render" })) };
    const fp = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const out = applyKernel(tools, { threadId: "t16", interactive: true, probePage: async () => fp });
    let last = "";
    for (const ref of ["e1", "e2", "e3"]) {
      last = String(await (out.browser_act as any).execute({ actions: [{ kind: "click", ref }] }));
    }
    const p = JSON.parse(last);
    assert.equal(p._kernel.verdict, "failed");
    assert.ok((p._kernel.hints || []).join(" ").match(/STOP flailing/), `expected flail steer, got: ${(p._kernel.hints || []).join(" | ").slice(0, 200)}`);
    StateTracker.resetForTests();
  });
});

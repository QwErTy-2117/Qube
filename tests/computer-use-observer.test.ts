import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { observePage, resolveRefLabel, describeRef, hashText, withConsoleNetworkSignals, type ObserverCdp } from "../lib/computer-use/observer";

function fakeCdp(values: Record<string, any>): ObserverCdp {
  return {
    getPageTarget: async () => ({ webSocketDebuggerUrl: "ws://fake" }),
    cdpCall: async (_ws, method, params) => {
      if (method === "Runtime.evaluate") {
        void params;
        return { result: { value: values.eval } };
      }
      return null;
    },
    evalIsolated: async (_ws, expr) => {
      if (String(expr).includes("__qubeObserversInstalled")) return true;
      if (String(expr).includes("data-qube-ref")) return values.desc ?? null;
      return values.eval;
    },
  };
}

describe("observer", () => {
  it("hashes text deterministically", () => {
    assert.equal(hashText("hello"), hashText("hello"));
    assert.notEqual(hashText("hello"), hashText("world"));
  });
  it("builds a fingerprint from eval", async () => {
    const cdp = fakeCdp({ eval: { title: "T", url: "https://x.com/", text: "hello world", dialog: false, consoleErrors: [], networkFailures: [] } });
    const obs = await observePage(cdp);
    assert.ok(obs);
    assert.equal(obs!.url, "https://x.com/");
    assert.equal(obs!.textHash, hashText("hello world"));
    assert.equal(obs!.textLen, 11);
  });
  it("returns null when no target", async () => {
    const cdp: ObserverCdp = { getPageTarget: async () => null, cdpCall: async () => null, evalIsolated: async () => null };
    assert.equal(await observePage(cdp), null);
  });
  it("resolves ref labels", async () => {
    const cdp = fakeCdp({ desc: { label: 'button "Buy now"', disabled: false, visible: true } });
    assert.equal(await resolveRefLabel(cdp, "e3"), 'button "Buy now"');
    assert.equal(await resolveRefLabel(cdp, "nope"), null);
  });
  it("describes disabled state", async () => {
    const cdp = fakeCdp({ desc: { label: 'button "Pay"', disabled: true, visible: true } });
    assert.deepEqual(await describeRef(cdp, "e2"), { label: 'button "Pay"', disabled: true, visible: true });
    const missing = fakeCdp({});
    assert.equal(await describeRef(missing, "e9"), null);
  });
  it("adds console/network signals", () => {
    const obs: any = { consoleErrors: [{ type: "error", text: "x" }], networkFailures: [] };
    assert.deepEqual(withConsoleNetworkSignals(["x"], obs), ["x", "console_errors"]);
    const obs2: any = { consoleErrors: [], networkFailures: [{ url: "u", errorText: "HTTP 500", status: 500 }] };
    assert.deepEqual(withConsoleNetworkSignals([], obs2), ["network_errors"]);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "../lib/computer-use/permission";
import { verifyResult } from "../lib/computer-use/verify";
import { planRecovery } from "../lib/computer-use/recovery";

describe("kernel policy", () => {
  it("flags financial labels", () => {
    assert.equal(classifyRisk({ label: "Place order", url: "https://shop.example.com/cart" }).risk, "financial");
  });
  it("flags destructive labels", () => {
    assert.equal(classifyRisk({ label: "Delete account", url: "https://x.com/" }).risk, "destructive");
  });
  it("does not flag cart removal", () => {
    assert.equal(classifyRisk({ label: "Remove from cart", url: "https://x.com/" }).risk, "interact");
  });
  it("flags password typing as credential", () => {
    assert.equal(classifyRisk({ label: "Password", typed: true }).risk, "credential");
  });
  it("detects stale ref failure", () => {
    const v = verifyResult({ ok: false, errorText: "Stale ref e4: page re-rendered" }, null, null, "interact");
    assert.equal(v.verdict, "failed");
    assert.ok(v.signals.includes("stale_ref"));
  });
  it("detects no-effect click", () => {
    const fp = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const v = verifyResult({ ok: true, errorText: "" }, fp, fp, "interact");
    assert.equal(v.verdict, "no_effect");
  });
  it("maps captcha to takeover hint", () => {
    const p = planRecovery({ verdict: "failed", changed: false, signals: ["captcha"] });
    assert.ok(p.hints.join(" ").includes("request_takeover"));
    assert.equal(p.autoSteps.length, 0);
  });
});

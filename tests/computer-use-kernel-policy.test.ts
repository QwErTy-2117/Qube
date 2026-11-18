import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "../lib/computer-use/permission";
import { verifyResult } from "../lib/computer-use/verify";
import { planRecovery } from "../lib/computer-use/recovery";

describe("kernel policy", () => {
  it("treats finance labels as ordinary interactions", () => {
    for (const label of ["Place order", "Buy now", "Confirm purchase", "Checkout", "Pay now", "Subscribe"]) {
      assert.equal(classifyRisk({ label, url: "https://shop.example.com/cart" }).risk, "interact", label);
    }
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
  it("detects form-value and focus changes as real effects", () => {
    const base = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const filled = { ...base, formHash: "f2" };
    const v = verifyResult({ ok: true, errorText: "" }, { ...base, formHash: "f1" }, filled, "input");
    assert.equal(v.verdict, "verified");
    assert.ok(v.signals.includes("form_changed"));
    const moved = { ...base, focus: 'button "Go"' };
    const v2 = verifyResult({ ok: true, errorText: "" }, base, moved, "interact");
    assert.equal(v2.verdict, "verified");
    assert.ok(v2.signals.includes("focus_changed"));
  });
  it("detects scrolls as real effects", () => {
    const base = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const v = verifyResult({ ok: true, errorText: "" }, { ...base, scrollY: 0 }, { ...base, scrollY: 400 }, "interact");
    assert.equal(v.verdict, "verified");
    assert.ok(v.signals.includes("scrolled"));
  });
  it("detects no-effect click", () => {
    const fp = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const v = verifyResult({ ok: true, errorText: "" }, fp, fp, "interact");
    assert.equal(v.verdict, "no_effect");
  });
  it("allows solving a captcha instead of forcing takeover", () => {
    const p = planRecovery({ verdict: "failed", changed: false, signals: ["captcha"] });
    const hint = p.hints.join(" ");
    assert.match(hint, /pass it in the page|solve/i);
    assert.doesNotMatch(hint, /do NOT try to solve/i);
    assert.equal(p.autoSteps.length, 0);
  });
  it("does not fail a changed page just because a captcha signal is present", () => {
    const pre = { at: 1, url: "https://x.com/", title: "t", textHash: "h1", textLen: 5, dialog: false };
    const post = { at: 2, url: "https://x.com/captcha-challenge", title: "t", textHash: "h2", textLen: 9, dialog: false };
    const v = verifyResult({ ok: true, errorText: "" }, pre, post, "interact");
    assert.notEqual(v.verdict, "failed");
    assert.ok(v.signals.includes("captcha"));
  });
});

describe("planner: stuck vs flailing", () => {
  it("stays quiet while progressing", async () => {
    const { assessReplan } = await import("../lib/computer-use/planner");
    assert.deepEqual(assessReplan({ consecutiveFailures: 0, distinctFailedSignatures: 0 }), { mode: "progressing", steer: null });
    assert.deepEqual(assessReplan({ consecutiveFailures: 2, distinctFailedSignatures: 2 }), { mode: "progressing", steer: null });
  });
  it("steers stuck runs to switch methods", async () => {
    const { assessReplan } = await import("../lib/computer-use/planner");
    const a = assessReplan({ consecutiveFailures: 3, distinctFailedSignatures: 1 });
    assert.equal(a.mode, "stuck");
    assert.match(a.steer || "", /different approach/);
  });
  it("steers flailing runs to step back and replan", async () => {
    const { assessReplan } = await import("../lib/computer-use/planner");
    const a = assessReplan({ consecutiveFailures: 4, distinctFailedSignatures: 3 });
    assert.equal(a.mode, "flailing");
    assert.match(a.steer || "", /different route|report the blocker/);
  });
});

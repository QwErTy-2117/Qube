import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeAction, isKernelTool } from "../lib/computer-use/catalog";

describe("kernel catalog", () => {
  it("classifies browser_screenshot as read-only browser observe", () => {
    const d = describeAction("browser_screenshot", {});
    assert.equal(d.domain, "browser");
    assert.equal(d.kind, "observe");
    assert.equal(d.mutating, false);
  });
  it("classifies browser_act click as mutating interact with target ref", () => {
    const d = describeAction("browser_act", { actions: [{ kind: "click", ref: "e3" }] });
    assert.equal(d.kind, "interact");
    assert.equal(d.mutating, true);
    assert.deepEqual(d.refs, ["e3"]);
  });
  it("classifies obu_ tools by suffix", () => {
    assert.equal(describeAction("obu_snapshot", {}).kind, "observe");
    assert.equal(describeAction("obu_click", { x: 1, y: 2 }).kind, "interact");
  });
  it("passes through unknown tools", () => {
    assert.equal(isKernelTool("TodoWrite"), false);
    assert.equal(describeAction("TodoWrite", {}).domain, "other");
  });
  it("treats run_command as terminal exec with command text", () => {
    const d = describeAction("run_command", { command: "npm test" });
    assert.equal(d.domain, "terminal");
    assert.equal(d.kind, "exec");
    assert.equal(d.targetText, "npm test");
  });
  it("classifies bare auto-mcp names like the obu_ ones", () => {
    assert.equal(describeAction("navigate", { url: "https://x.com/" }).kind, "navigate");
    const a = describeAction("act", { actions: [{ kind: "click", ref: "e1" }] });
    assert.equal(a.kind, "interact");
    assert.deepEqual(a.refs, ["e1"]);
    assert.equal(describeAction("tabs", {}).kind, "observe");
    assert.equal(describeAction("snapshot", {}).kind, "observe");
    assert.deepEqual(describeAction("click", { x: 1, y: 2 }).points, [{ x: 1, y: 2 }]);
    assert.equal(describeAction("type", { text: "hi" }).kind, "input");
    assert.equal(describeAction("close_tab", {}).mutating, true);
    assert.equal(describeAction("switch_tab", {}).mutating, false);
    assert.equal(describeAction("obu_act", { actions: [{ kind: "click", ref: "e1" }] }).kind, "interact");
  });
  it("leaves unknown bare names alone", () => {
    assert.equal(describeAction("frobnicate", {}).domain, "other");
    assert.equal(isKernelTool("frobnicate"), false);
    assert.equal(isKernelTool("act"), true);
  });
});

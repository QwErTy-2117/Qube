import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { finishedGroupTitle } from "@/components/assistant-ui/tools/group-title";

describe("finishedGroupTitle", () => {
  it("single tool shows its friendly label, never used 1 tool", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["Going down a rabbit hole"], visibleCount: 1, connectorOnly: false, connectorAppCount: 0 }),
      "Going down a rabbit hole",
    );
  });

  it("single connector app group says used 1 app", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["Fiddling with your inbox"], visibleCount: 1, connectorOnly: true, connectorAppCount: 1 }),
      "used 1 app",
    );
  });

  it("two connector apps say used 2 apps", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["a", "b"], visibleCount: 2, connectorOnly: true, connectorAppCount: 2 }),
      "used 2 apps",
    );
  });

  it("three tool calls on one app say used 1 app", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["a", "b", "c"], visibleCount: 3, connectorOnly: true, connectorAppCount: 1 }),
      "used 1 app",
    );
  });

  it("mixed groups keep the last label when connector icons exist", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["Going down a rabbit hole", "Poking the repo"], visibleCount: 2, connectorOnly: false, connectorAppCount: 1, hasConnectorIcons: true }),
      "Poking the repo",
    );
  });

  it("mixed groups without connectors keep used N tools", () => {
    assert.equal(
      finishedGroupTitle({ labels: ["a", "b"], visibleCount: 2, connectorOnly: false, connectorAppCount: 0 }),
      "used 2 tools",
    );
  });

  it("falls back to Working on it with no labels", () => {
    assert.equal(
      finishedGroupTitle({ labels: [], visibleCount: 2, connectorOnly: false, connectorAppCount: 0 }),
      "Working on it",
    );
  });
});

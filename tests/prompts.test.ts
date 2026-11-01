/**
 * Prompt date-anchoring regression tests.
 *
 * Isolated prompts (subagents, background tasks) get a fresh context window
 * with no parent history. Without an explicit current time, models fall back
 * to their training cutoff as "today" (observed: refusing Sept 2026 research
 * as "the future" while believing it is 2024/2025).
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/prompts.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSubagentSystemPrompt } from "@/lib/pi/subagents";
import { browserUseInstructions } from "@/lib/pi/prompt-context";
import { buildPiTaskSystemPrompt } from "@/lib/pi/task-runner";

const currentYear = String(new Date().getFullYear());

describe("subagent system prompt", () => {
  it("anchors the current time for every agent type", () => {
    for (const agentType of ["Explore", "researcher", "reviewer", "general", "weird-type"]) {
      const prompt = buildSubagentSystemPrompt(agentType);
      assert.match(prompt, /Current time:/, `${agentType} prompt must state the current time`);
      assert.ok(
        prompt.includes(currentYear),
        `${agentType} prompt must contain the current year ${currentYear}`,
      );
    }
  });

  it("keeps skills hint support", () => {
    const prompt = buildSubagentSystemPrompt("researcher", "Installed: foo. Apply one.");
    assert.match(prompt, /Installed: foo/);
    assert.match(prompt, /Current time:/);
  });
});

describe("browser instructions describe the live kernel contract", () => {
  it("documents verdicts, repeat discipline, disabled targets, takeover, and gating", () => {
    const text = browserUseInstructions(true);
    for (const term of [
      "_kernel",
      "blocked/denied",
      "repeat-warned",
      "Disabled targets fail before acting",
      "request_takeover",
      "CAPTCHAs",
      "approval",
    ]) {
      assert.ok(text.includes(term), `browser instructions must mention: ${term}`);
    }
  });
});

describe("background task system prompt", () => {
  const task: any = {
    name: "test",
    type: "once",
    instructions: "Do things.",
    permissions: { runCommands: true, destructiveCommands: false, webAccess: true },
  };

  it("anchors the current time", () => {
    const prompt = buildPiTaskSystemPrompt(task);
    assert.match(prompt, /Current time:/);
    assert.ok(prompt.includes(currentYear), `task prompt must contain ${currentYear}`);
    assert.match(prompt, /Do things\./);
  });
});

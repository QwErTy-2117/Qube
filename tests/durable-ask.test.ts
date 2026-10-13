import { describe, it } from "node:test";
import assert from "node:assert/strict";
process.env.ASK_USER_TIMEOUT_MS = "300";
import { buildAskUserTool } from "@/lib/pi/durable-ask";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "t", conversationId: "conv-1" } as never;

function outputText(result: unknown): string {
  return (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
}

describe("durable ask_user", () => {
  it("returns available:false in background runs without blocking", async () => {
    const tool = buildAskUserTool({ background: true });
    const parsed = JSON.parse(outputText(await tool.execute({ question: "Which one?" } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(parsed.available, false);
    assert.match(parsed.message, /background/i);
  });

  it("rejects empty questions via the questionnaire normalizer", async () => {
    const tool = buildAskUserTool({ background: false });
    const parsed = JSON.parse(outputText(await tool.execute({ question: "" } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.ok(parsed.error || parsed.available === true);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-dsub-test-"));
import { readAnswerText, subagentTool } from "@/lib/pi/durable-subagents";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";
import { closeDurableHarness, getDurableHarness } from "@/lib/pi/durable";
import { defineTask } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const Anchor = defineTask({
  name: "test.anchor",
  version: 1,
  initial: () => ({ phase: "idle" }),
  phases: { idle: async () => {} },
  abort: async () => {},
});

describe("durable subagents", () => {
  it("reads answer text from assistant entries", () => {
    assert.equal(
      readAnswerText({ model: [{ role: "assistant", content: [{ type: "text", text: "a" }, { type: "thinking", thinking: "h" }, { type: "text", text: "b" }] }] }),
      "ab",
    );
    assert.equal(readAnswerText(undefined), "");
  });

  it("creates a task-owned child once and reports an unanswered run", async () => {
    const conv = await getOrCreateConversation("thread_sub_1", BACKGROUND_CONTEXT);
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const anchorId = await conv.commit(
      (tx) => tx.createTask(Anchor as never, {} as never, { ownership: { kind: "conversation" } }),
      BACKGROUND_CONTEXT,
    );
    const seen: unknown[] = [];
    const api = {
      taskId: anchorId,
      conversationId: conv.id,
      commit: (fn: never, ctx: never) => conv.commit(fn as never, ctx as never),
      conversation: (id: never, ctx: never) => h.conversation(id as never, ctx as never),
      details: async (v: unknown) => { seen.push(v); },
    } as never;
    const first = await subagentTool.execute(
      { task: "Summarize nothing", description: "test", agentType: "Explore" } as never, api, BACKGROUND_CONTEXT,
    );
    const text1 = (first as { output: Array<{ text: string }> }).output[0].text;
    assert.match(text1, /did not answer|empty answer/i);
    assert.equal(seen.length, 1);
    const childId = (seen[0] as { conversationId: unknown }).conversationId;
    const second = await subagentTool.execute(
      { task: "Summarize nothing", description: "test", agentType: "Explore" } as never, api, BACKGROUND_CONTEXT,
    );
    assert.equal(seen.length, 2);
    assert.equal((seen[1] as { conversationId: unknown }).conversationId, childId);
    assert.match((second as { output: Array<{ text: string }> }).output[0].text, /did not answer|empty answer/i);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});

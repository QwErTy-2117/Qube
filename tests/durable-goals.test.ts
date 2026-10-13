import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-goals-test-"));
import { todoWriteTool } from "@/lib/pi/durable-goals";
import { Todos } from "@/lib/pi/durable-docs";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";
import { closeDurableHarness, getDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable goals", () => {
  it("writes the checklist to the conversation doc", async () => {
    const conv = await getOrCreateConversation("thread_goals_1", BACKGROUND_CONTEXT);
    const api = {
      taskId: "test-task-goals" as never,
      conversationId: conv.id as never,
      commit: (fn: never, ctx: never) => conv.commit(fn as never, ctx as never),
    } as never;
    const result = await todoWriteTool.execute(
      { todos: [{ content: "Write code", status: "in_progress", activeForm: "Writing code" }, { content: "Test", status: "pending" }] } as never,
      api,
      BACKGROUND_CONTEXT,
    );
    const text = (result as { output: Array<{ text: string }> }).output[0].text;
    assert.match(text, /0\/2 done/);
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const snap = await h.snapshot(Todos, conv.id, BACKGROUND_CONTEXT);
    assert.deepEqual([...(snap?.items ?? [])], ["[~] Write code", "[ ] Test"]);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});

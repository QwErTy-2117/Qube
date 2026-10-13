import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-notes-test-"));
import { appendScratchpadTool, readScratchpadTool, writeScratchpadTool } from "@/lib/pi/durable-goals";
import { Scratchpad } from "@/lib/pi/durable-docs";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";
import { closeDurableHarness, getDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable notes", () => {
  it("writes, reads, and appends via the conversation doc", async () => {
    const conv = await getOrCreateConversation("thread_notes_1", BACKGROUND_CONTEXT);
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const api = {
      taskId: "test-task-notes",
      conversationId: conv.id,
      commit: (fn: never, ctx: never) => conv.commit(fn as never, ctx as never),
      snapshot: (token: never, id: never, ctx: never) => h.snapshot(token as never, id as never, ctx as never),
    } as never;

    const empty = await readScratchpadTool.execute({} as never, api, BACKGROUND_CONTEXT);
    assert.match((empty as { output: Array<{ text: string }> }).output[0].text, /empty/);

    await writeScratchpadTool.execute({ content: "step 1 done" } as never, api, BACKGROUND_CONTEXT);
    const read = await readScratchpadTool.execute({} as never, api, BACKGROUND_CONTEXT);
    assert.equal((read as { output: Array<{ text: string }> }).output[0].text, "step 1 done");

    await appendScratchpadTool.execute({ chunk: "step 2 done" } as never, api, BACKGROUND_CONTEXT);
    const snap = await h.snapshot(Scratchpad, conv.id, BACKGROUND_CONTEXT);
    assert.equal(snap?.text, "step 1 done\nstep 2 done");
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});

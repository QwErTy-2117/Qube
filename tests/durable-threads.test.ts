import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-threads-test-"));
import { getOrCreateConversation, listDurableThreads } from "@/lib/pi/durable-conversations";
import { closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable conversations", () => {
  it("reuses the same conversation for the same qube thread id", async () => {
    const a = await getOrCreateConversation("thread_test_1", BACKGROUND_CONTEXT);
    const b = await getOrCreateConversation("thread_test_1", BACKGROUND_CONTEXT);
    assert.equal(a.id, b.id);
  });

  it("lists created threads by qube id", async () => {
    await getOrCreateConversation("thread_test_2", BACKGROUND_CONTEXT);
    const threads = await listDurableThreads(BACKGROUND_CONTEXT);
    const ids = threads.map((t) => t.id);
    assert.ok(ids.includes("thread_test_1"));
    assert.ok(ids.includes("thread_test_2"));
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});

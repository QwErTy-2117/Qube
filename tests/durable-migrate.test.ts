import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-migrate-test-"));
import { buildHandoffNote, migrateSessions, migrateThreadRecord, parseTranscriptLines } from "../scripts/migrate-to-durable";
import { saveSession } from "@/lib/memory/session-store";
import { getOrCreateConversation, listDurableThreads } from "@/lib/pi/durable-conversations";
import { closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable migration", () => {
  it("preserves thread id", () => {
    assert.equal(migrateThreadRecord({ id: "thread_1", title: "Hi" }).id, "thread_1");
  });

  it("parses role-prefixed transcripts with continuations", () => {
    const blocks = parseTranscriptLines("user: hello\nworld\nassistant: hi [tool call: read_file]\nassistant: done");
    assert.deepEqual(blocks, [
      { role: "user", text: "hello\nworld" },
      { role: "assistant", text: "hi [tool call: read_file]\ndone" },
    ]);
    assert.deepEqual(parseTranscriptLines(""), []);
    assert.deepEqual(parseTranscriptLines("just prose"), [{ role: "note", text: "just prose" }]);
  });

  it("builds a model-visible handoff note keeping the recent tail", () => {
    assert.equal(buildHandoffNote([]), "");
    const note = buildHandoffNote([{ role: "user", text: "hello" }, { role: "assistant", text: "hi" }]);
    assert.match(note, /imported from an earlier session/);
    assert.match(note, /User: hello/);
    assert.match(note, /Assistant: hi/);
    const long = buildHandoffNote([{ role: "user", text: "x".repeat(10000) }], 100);
    assert.ok(long.length < 400);
  });

  it("imports sessions once with titles and history entries", async () => {
    await saveSession("thread_mig_1", "Trip planning", "", "user: plan rome\nassistant: hotels...", true);
    const first = await migrateSessions(BACKGROUND_CONTEXT);
    assert.ok(first.migrated.includes("thread_mig_1"));
    const threads = await listDurableThreads(BACKGROUND_CONTEXT);
    assert.equal(threads.find((t) => t.id === "thread_mig_1")?.title, "Trip planning");
    const conv = await getOrCreateConversation("thread_mig_1", BACKGROUND_CONTEXT);
    const page = await conv.commit(
      (tx) => tx.scanEntries({ conversationId: conv.id, order: "ascending" }, 50),
      BACKGROUND_CONTEXT,
    );
    assert.ok(page.items.some((e) => e.kind === "qube.history"));
    // The imported context is model-visible (handoff reset).
    const view = await conv.context(BACKGROUND_CONTEXT);
    assert.match(JSON.stringify(view.messages), /plan rome/);
    const second = await migrateSessions(BACKGROUND_CONTEXT);
    assert.ok(second.skipped.includes("thread_mig_1"));
    assert.ok(!second.migrated.includes("thread_mig_1"));
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});

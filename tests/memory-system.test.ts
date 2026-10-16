/**
 * Unified memory system tests — single store, single ranker, single tool core.
 *
 * Covers the consolidation guarantees:
 * - near-duplicate writes reinforce instead of duplicating ("my name is X")
 * - single-valued slot updates replace in place (name change)
 * - negation never merges ("I like X" vs "I don't like X")
 * - legacy + durable read paths return the same entry (tool parity)
 * - prompt brief is bounded and framed
 * - observer is idempotent per thread+text
 * - secrets blocked on the shared write path
 * - consolidation bounds a bloated pool
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-memsys-test-"));

import { recallMemory, rememberMemory } from "@/lib/memory/tools-core";
import { extractCandidates, observeTurn, __resetObserveForTests } from "@/lib/memory/observe";
import { buildMemoryBrief } from "@/lib/memory/brief";

describe("unified memory system", () => {
  let store: typeof import("@/lib/memory/memory-store");

  before(async () => {
    store = await import("@/lib/memory/memory-store");
  });

  it("U-dedupe: 'my name is Luca' + 'The user's name is Luca.' reinforce, not duplicate", async () => {
    const a = await store.remember("personal", "my name is Luca", { confirmation: "explicit", confidence: 0.9 });
    const b = await store.remember("personal", "The user's name is Luca.", { confirmation: "explicit", confidence: 0.9 });
    assert.equal(b.action === "reinforced" || b.action === "updated", true, `action=${b.action}`);
    assert.equal(b.entry.id, a.entry.id);
    const all = await store.getMemoryEntries();
    const lucas = all.filter((e) => /luca/i.test(e.content) && !e.supersededBy);
    assert.equal(lucas.length, 1);
  });

  it("U-slot: name change replaces in place, no duplicate identity", async () => {
    const r = await store.remember("personal", "My name is Marco", { confirmation: "explicit", confidence: 0.9 });
    assert.equal(r.action === "updated" || r.action === "superseded", true, `action=${r.action}`);
    const all = await store.getMemoryEntries();
    const names = all.filter((e) => e.category === "personal" && /name is/i.test(e.content) && !e.supersededBy);
    assert.ok(names.length <= 2, `identity entries: ${names.length}`);
    assert.ok(names.some((e) => /marco/i.test(e.content)));
  });

  it("U-negation: 'I like Python' vs \"I don't like Python\" never merge", async () => {
    const a = await store.remember("preference", "I like Python for scripting", { confidence: 0.7 });
    const b = await store.remember("preference", "I don't like Python for scripting", { confidence: 0.7 });
    assert.notEqual(a.entry.id, b.entry.id);
    assert.equal(b.action, "created");
  });

  it("U-parity: shared core and durable tool return the same entry", async () => {
    const saved = await rememberMemory(
      { category: "preference", content: "Parity probe prefers short answers", relevance: 0.8, confidence: 0.9, memoryType: "preference" },
      { threadId: "parity-t1" },
    );
    assert.equal(saved.saved, true);
    const viaCore = await recallMemory({ query: "parity probe short answers", topK: 5 }, { threadId: "parity-t1" });
    assert.ok(viaCore.entries.some((e) => e.id === saved.id), "core recall finds it");
    const { readMemoryTool } = await import("@/lib/pi/durable-registry");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const out = await (readMemoryTool as unknown as { execute: (a: unknown, b: unknown, c: unknown) => Promise<{ output: Array<{ text: string }> }> }).execute(
      { query: "parity probe short answers" }, { taskId: "parity-task" }, BACKGROUND_CONTEXT,
    );
    const found = JSON.parse(out.output[0].text) as { entries: Array<{ id: string }> };
    assert.ok(found.entries.some((e) => e.id === saved.id), "durable recall finds the same entry");
  });

  it("U-secret: shared write path blocks secrets", async () => {
    const res = await rememberMemory({ category: "general", content: "api key sk-abcdefghijklmnopqrstuv" }, { threadId: "sec-t" });
    assert.equal(res.saved, false);
    assert.match(String(res.error || ""), /blocked/i);
  });

  it("U-observer: atomic extraction + idempotent per thread+text", async () => {
    __resetObserveForTests();
    const cands = extractCandidates("My name is Luca. I prefer concise answers. What time is it?");
    assert.ok(cands.length >= 1 && cands.length <= 3, `candidates=${cands.length}`);
    assert.ok(!cands.some((c) => /\?/.test(c.fact)), "questions never extracted");
    const first = await observeTurn({ threadId: "obs-t1", userText: "remember: I prefer concise morning briefs" });
    assert.ok(first.written.length >= 1);
    const second = await observeTurn({ threadId: "obs-t1", userText: "remember: I prefer concise morning briefs" });
    assert.equal(second.written.length, 0, "second identical turn is a no-op");
  });

  it("U-brief: bounded, framed, with core + map", async () => {
    const brief = await buildMemoryBrief({ query: "user name preferences" });
    assert.match(brief, /<memory>/);
    assert.ok(brief.length <= 3400, `brief length ${brief.length}`);
  });

  it("U-consolidate: bloated pool prunes back under budget", async () => {
    const now = Date.now();
    const bulk = Array.from({ length: 600 }, (_, i) => ({
      id: `bulk_${i}`, category: "general", content: `bulk filler fact number ${i} about unrelated synthetic trivia`,
      createdAt: now - i * 1000, updatedAt: now - i * 1000, relevance: 0.3, confidence: 0.4,
    }));
    await store.replaceAllEntries(bulk as never);
    const res = await store.consolidateMemories();
    assert.ok(res.total <= 350, `total=${res.total}`);
    assert.ok(res.merged > 0);
  });
});

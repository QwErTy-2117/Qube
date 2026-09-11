/**
 * Memory + skills tests — 25 generalized scenarios.
 *
 * Covers objective §§2-14, 23-26, 28-30 (memory side):
 * cross-chat persistence, auto + explicit retrieval, relevance filtering,
 * scope handling, preference learning, contradiction handling, confidence
 * updates, duplicate consolidation, post-task extraction, recurring-topic
 * detection, expiration, secret filtering, skill creation/validation/
 * lifecycle/scoping, memory↔skill interaction, and regression of the
 * legacy 4-arg memory API.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/memory-skills.test.ts
 * (or `npm test`, which provisions an isolated temp dir automatically)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Env must be set before the store module is first imported (DUAL_FILE is
// bound at module load). Dynamic imports below run after this assignment.
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-mem-test-"));

import {
  withMemoryDefaults,
  categoryToMemoryType,
  confidenceForEvidence,
  isMemoryExpired,
} from "@/lib/memory/memory-schema";
import {
  containsSecret,
  checkPersistable,
  redactSecrets,
  isSensitiveInference,
  sanitizeCategory,
} from "@/lib/memory/safety";
import {
  scoreMemory,
  rankMemories,
  dedupeMemories,
  toBoundedContext,
  buildQueries,
  type RankableMemory,
} from "@/lib/memory/retrieval";
import {
  isMeaningfulTask,
  generalizeContent,
  resolveContradiction,
  consolidateGroup,
  inferPreference,
  detectFollowupOpportunity,
} from "@/lib/memory/learning";
import {
  evaluateSkillCreation,
  skillSpecificity,
  isGeneralizableSkill,
  validateSkillDraft,
  nextSkillStatus,
  draftToSkillConfig,
} from "@/lib/skills/learner";

const NOW = 1_786_000_000_000;

function mem(over: Partial<RankableMemory> = {}): RankableMemory {
  return {
    id: `m_${Math.random().toString(36).slice(2, 8)}`,
    content: "user prefers concise answers",
    category: "preference",
    relevance: 0.7,
    confidence: 0.8,
    updatedAt: NOW,
    createdAt: NOW - 1000,
    ...over,
  };
}

// ---------- schema / metadata ----------

describe("memory schema", () => {
  it("M-schema: defaults fill type/scope/confirmation without clobbering", () => {
    const e = withMemoryDefaults({ content: "x", scopeKey: "proj" });
    assert.equal(e.memoryType, "context");
    assert.equal(e.scope, "global_user");
    assert.equal(e.confirmation, "inferred");
    assert.equal(e.actionStatus, "none");
    assert.equal(e.scopeKey, "proj");
  });

  it("M-schema: legacy categories map to rich types", () => {
    assert.equal(categoryToMemoryType("preference", "likes csv"), "preference");
    assert.equal(categoryToMemoryType("decision", "we chose X"), "decision");
    assert.equal(categoryToMemoryType("general", "deadline friday, remind me"), "pending_followup");
    assert.equal(categoryToMemoryType("general", "workaround for flaky load"), "lesson_failure");
  });

  it("M-conf: explicit > repeated > single inference; contradiction weakens", () => {
    const explicit = confidenceForEvidence({ explicit: true, occurrences: 1 });
    const repeated = confidenceForEvidence({ explicit: false, occurrences: 3 });
    const single = confidenceForEvidence({ explicit: false, occurrences: 1 });
    const contradicted = confidenceForEvidence({ explicit: false, occurrences: 3, contradicted: true });
    assert.ok(explicit >= 0.85);
    assert.ok(repeated >= 0.75 && repeated < explicit);
    assert.ok(single <= 0.5);
    assert.ok(contradicted < repeated);
  });

  it("M-expire: expired memories are detected and score to zero", () => {
    assert.equal(isMemoryExpired({ expiresAt: NOW - 1 }, NOW), true);
    assert.equal(isMemoryExpired({ expiresAt: NOW + 1000 }, NOW), false);
    const scored = scoreMemory(
      mem({ expiresAt: NOW - 1, content: "user prefers concise answers always" }),
      { text: "user prefers concise answers" },
      NOW,
    );
    assert.equal(scored.score, 0);
  });
});

// ---------- retrieval pipeline ----------

describe("retrieval pipeline", () => {
  it("M-relevance: topical overlap outranks unrelated memory", () => {
    const a = mem({ id: "a", content: "user prefers concise answers for summaries" });
    const b = mem({ id: "b", content: "the office plant needs watering on tuesdays" });
    const ranked = rankMemories([b, a], { text: "does the user prefer concise answers?" }, NOW);
    assert.equal(ranked[0].memory.id, "a");
  });

  it("M-scope: project memory sinks without scopeKey, wins with match", () => {
    const global = mem({ id: "g", scope: "global_user", content: "prefers csv exports for tables" });
    const scoped = mem({ id: "p", scope: "project", scopeKey: "alpha", content: "prefers csv exports for tables" });
    const noScope = rankMemories([scoped, global], { text: "prefers csv exports for tables" }, NOW);
    assert.equal(noScope[0].memory.id, "g");
    const withScope = rankMemories([scoped, global], { text: "prefers csv exports for tables", scopeKey: "alpha" }, NOW);
    assert.equal(withScope[0].memory.id, "p");
    const otherScope = rankMemories([scoped, global], { text: "prefers csv exports for tables", scopeKey: "beta" }, NOW);
    assert.equal(otherScope[0].memory.id, "g");
  });

  it("M-confidence: weak single inference sinks below solid match", () => {
    const weak = mem({ id: "w", confidence: 0.2, content: "migrating dashboards to Grafana eventually maybe" });
    const solid = mem({ id: "s", confidence: 0.9, content: "user prefers concise answers" });
    const ranked = rankMemories([weak, solid], { text: "user prefers concise answers" }, NOW);
    assert.equal(ranked[0].memory.id, "s");
  });

  it("M-bounded: context injection respects the char budget", () => {
    const scored = rankMemories(
      [mem({ id: "a" }), mem({ id: "b", content: "second fact here" })],
      { text: "fact" },
      NOW,
    );
    const full = toBoundedContext(scored, 10_000);
    const tiny = toBoundedContext(scored, 20);
    assert.ok(full.includes("concise") || full.includes("second"));
    assert.ok(tiny.length <= 120); // at most one truncated line
  });

  it("M-queries: builder produces task + proactive queries", () => {
    const qs = buildQueries({ userText: "summarize inbox", projectKey: "alpha", proactiveTopic: "tech news" });
    assert.equal(qs.length, 2);
    assert.equal(qs[1].proactiveMode, true);
  });

  it("M-dedupe: near-identical memories collapse, higher confidence wins", () => {
    const entries = [
      { id: "old", content: "user prefers concise answers", confidence: 0.5, updatedAt: NOW - 5000 },
      { id: "new", content: "user prefers concise answers", confidence: 0.8, updatedAt: NOW },
      { id: "other", content: "completely different fact about deploy pipeline", confidence: 0.6, updatedAt: NOW },
    ];
    const out = dedupeMemories(entries);
    assert.equal(out.length, 2);
    assert.ok(out.some((e) => e.id === "new"));
  });
});

// ---------- learning / generalization / contradiction ----------

describe("learning pass", () => {
  it("M-gate: meaningful tasks pass, trivial chatter does not", () => {
    assert.equal(isMeaningfulTask({ toolCalls: 4, filesChanged: 0, userText: "hi", taskSuccess: true }), true);
    assert.equal(isMeaningfulTask({ toolCalls: 0, filesChanged: 0, userText: "hi", taskSuccess: true }), false);
    assert.equal(isMeaningfulTask({ toolCalls: 0, filesChanged: 0, userText: "remember my csv preference", taskSuccess: true }), true);
    assert.equal(isMeaningfulTask({ toolCalls: 2, filesChanged: 0, userText: "broken", taskSuccess: false }), true);
  });

  it("M-generalize: specific incident widens to reusable principle", () => {
    const { generalized, wasSpecific } = generalizeContent("On September 10 the user used https://example.com and clicked button Y");
    assert.equal(wasSpecific, true);
    assert.ok(!generalized.includes("https://example.com"));
    assert.ok(generalized.includes("General principle"));
  });

  it("M-generalize: already-general content passes through", () => {
    const { wasSpecific, generalized } = generalizeContent(
      "When extracting structured information from dynamically loaded sites, identify the data source first",
    );
    assert.equal(wasSpecific, false);
    assert.ok(generalized.startsWith("When extracting"));
  });

  it("M-contradiction: general + specific merge to conditional preference", () => {
    const r = resolveContradiction(
      { id: "1", content: "User generally prefers concise answers", category: "preference", confidence: 0.8, relevance: 0.7, updatedAt: NOW },
      "please give me a detailed technical explanation",
      { now: NOW },
    );
    assert.equal(r.action, "update");
    assert.ok("mergedContent" in r && (r as any).mergedContent.includes("Generally prefers concise"));
  });

  it("M-contradiction: temporary exception keeps the standing rule", () => {
    const r = resolveContradiction(
      { id: "1", content: "User prefers csv exports", category: "preference", confidence: 0.85, relevance: 0.7, updatedAt: NOW },
      "just this once export as xlsx",
      { now: NOW },
    );
    assert.equal(r.action, "temporary_exception");
    assert.ok((r as any).expiresAt > NOW);
  });

  it("M-contradiction: context-specific observation narrows scope", () => {
    const r = resolveContradiction(
      { id: "1", content: "User prefers concise answers", category: "preference", confidence: 0.8, relevance: 0.7, updatedAt: NOW },
      "for technical implementation work I want thorough detail",
      { now: NOW },
    );
    assert.equal(r.action, "narrow_scope");
  });

  it("M-preference: explicit statement is high confidence, weak signal is not", () => {
    const explicit = inferPreference("remember: call me Luca");
    assert.ok(explicit && explicit.confidence >= 0.85 && explicit.confirmation === "explicit");
    const weak = inferPreference("I saw a dashboard once");
    assert.equal(weak, null);
    const single = inferPreference("I like concise summaries");
    assert.ok(single && single.confidence <= 0.5 && single.confirmation === "inferred");
  });

  it("M-followup: deadlines and recurring hints detected, single mentions not over-inferred", () => {
    assert.equal(detectFollowupOpportunity("deadline is friday, remind me")?.kind, "deadline");
    assert.equal(detectFollowupOpportunity("send me updates every week")?.kind, "recurring_hint");
    assert.equal(detectFollowupOpportunity("what is the capital of Peru?"), null);
  });

  it("M-consolidate: repeated observations strengthen instead of duplicating", () => {
    const merged = consolidateGroup([
      { content: "prefers csv", confidence: 0.6, relevance: 0.6, updatedAt: NOW - 9, createdAt: NOW - 99 },
      { content: "prefers csv", confidence: 0.7, relevance: 0.7, topics: ["csv"], updatedAt: NOW, createdAt: NOW - 50 },
    ]);
    assert.ok(merged.confidence >= 0.7);
    assert.deepEqual(merged.topics, ["csv"]);
  });
});

// ---------- safety ----------

describe("safety", () => {
  it("M-safety: api keys, tokens, passwords blocked; redaction works", () => {
    assert.equal(containsSecret("my api key: sk-abcdefghijklmnopqrstuv"), true);
    assert.equal(checkPersistable("token sk-abcdefghijklmnopqrstuv here").ok, false);
    assert.equal(checkPersistable("remember I prefer csv").ok, true);
    assert.ok(redactSecrets("password: hunter2 please").includes("[REDACTED]"));
    assert.equal(checkPersistable("   ").ok, false);
  });

  it("M-safety: sensitive personal inference blocked", () => {
    assert.equal(isSensitiveInference("the user has a medical diagnosis of X"), true);
    assert.equal(isSensitiveInference("the user prefers morning meetings"), false);
  });

  it("M-safety: unknown categories sanitize to general", () => {
    assert.equal(sanitizeCategory("preference"), "preference");
    assert.equal(sanitizeCategory("super-secret-category"), "general");
  });
});

// ---------- skills ----------

describe("self-created skills", () => {
  const GOOD = [
    "When a site requires navigation through a client-rendered interface, first identify the page state and",
    "locate the target data semantically. If the visible interface does not expose the information, inspect",
    "available structured sources before attempting repeated clicks. Validate the result by checking that",
    "the extracted fields match the expected schema, and adapt the selectors to the current layout rather",
    "than replaying exact steps from a previous session. Prefer stable identifiers over positional clicks.",
  ].join(" ");

  it("S-criteria: reusable multi-step recovery justifies a candidate", () => {
    const e = evaluateSkillCreation({ occurrences: 2, stepsCount: 4, hadRecovery: true, validated: true, recurrenceLikelihood: 0.7, generalizable: true });
    assert.equal(e.shouldCreate, true);
    assert.ok(e.score >= 5);
  });

  it("S-criteria: one-off single step does not justify a skill", () => {
    const e = evaluateSkillCreation({ occurrences: 1, stepsCount: 1, hadRecovery: false, validated: false, recurrenceLikelihood: 0.2, generalizable: false });
    assert.equal(e.shouldCreate, false);
  });

  it("S-generalize: strategy passes, hardcoded click-path fails validation", () => {
    assert.equal(isGeneralizableSkill(GOOD), true);
    const short = "For https://example.com click button \"Export\" then click \"CSV\".";
    assert.equal(isGeneralizableSkill(short), false);
    assert.ok(skillSpecificity(short).flags.includes("hardcoded URL"));
    // Long enough to pass the word-count gate, still instance-specific.
    const bad = [
      "For https://example.com open the dashboard and click button \"Export\", then click \"CSV\" in the dialog,",
      "then wait for the download to finish and move the file into the reports folder every single time",
      "without checking anything else or adapting to any other site, repeating these exact clicks verbatim.",
    ].join(" ");
    assert.ok(bad.trim().split(/\s+/).length >= 30);
    const err = validateSkillDraft({ name: "x-site-export", description: "Exports tables. Use when exporting tables.", instructions: bad, whenToUse: "when exporting" });
    assert.ok(err && err.includes("instance-specific"));
  });

  it("S-lifecycle: success promotes candidate→tested→trusted; failure demotes", () => {
    assert.equal(nextSkillStatus("candidate", { skillName: "s", success: true, contextChanged: false }).next, "tested");
    assert.equal(nextSkillStatus("tested", { skillName: "s", success: true, contextChanged: false }).next, "trusted");
    assert.equal(nextSkillStatus("trusted", { skillName: "s", success: false, contextChanged: false }).next, "tested");
    assert.equal(nextSkillStatus("deprecated", { skillName: "s", success: true, contextChanged: false }).next, "deprecated");
  });

  it("S-misapply: failure from changed context keeps status (narrow scope instead)", () => {
    const r = nextSkillStatus("trusted", { skillName: "s", success: false, contextChanged: true });
    assert.equal(r.next, "trusted");
    assert.ok(r.note.includes("narrow scope"));
  });

  it("S-interaction: draft normalizes to store-ready skill with scope/provenance", () => {
    const cfg = draftToSkillConfig({
      name: "Retry-Render", description: "Recovers transient render failures. Use when content flakes.", instructions: GOOD,
      whenToUse: "when client-rendered content fails transiently", preconditions: ["page loaded"],
      failureModes: ["still empty after retry"], recoverySteps: ["inspect structured source"],
      validation: "succeeds twice on different sites", scope: "global_user", confidence: 0.55, provenance: "thread:t1",
    });
    assert.equal(cfg.name, "retry-render");
    assert.ok(cfg.instructions.includes("## Procedure") && cfg.instructions.includes("## Validation"));
  });
});

// ---------- persistence + regression (disk-backed) ----------

describe("persistence and regression", () => {
  let store: typeof import("@/lib/memory/memory-store");

  before(async () => {
    store = await import("@/lib/memory/memory-store");
  });

  it("M-persist: memory written in one chat is readable in another (disk round-trip)", async () => {
    const entry = await (store as any).addMemoryEntryExt("preference", "cross-chat probe prefers csv exports", {
      confidence: 0.9, memoryType: "preference", provenance: "test",
    });
    assert.ok(entry.id);
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(process.env.QUBE_DATA_DIR!, ".memory", "dual-memory.json"), "utf-8");
    assert.ok(raw.includes("cross-chat probe prefers csv exports"));
  });

  it("M-manual: explicit filtered search finds prior-chat knowledge", async () => {
    const found = await (store as any).searchMemories({ query: "cross-chat probe csv exports", memoryType: "preference", topK: 5 });
    assert.ok(found.length >= 1 && found[0].content.includes("cross-chat probe"));
    const noneScoped = await (store as any).searchMemories({ query: "cross-chat probe csv", scope: "project", scopeKey: "other-project", topK: 5 });
    assert.ok(!noneScoped.some((e: any) => e.content.includes("cross-chat probe")));
  });

  it("M-regression: legacy 4-arg add still works and backfills scope", async () => {
    const entry = await store.addMemoryEntry("general", "legacy regression probe entry", 0.5, 0.6);
    assert.equal(entry.category, "general");
    assert.equal(entry.scope, "global_user");
  });

  it("M-regression: secret write via legacy path is refused, not stored", async () => {
    await assert.rejects(() => store.addMemoryEntry("general", "api key sk-abcdefghijklmnopqrstuv", 0.5));
    const all = await store.getMemoryEntries();
    assert.ok(!all.some((e) => e.content.includes("sk-abcdefghijklmnopqrstuv")));
  });

  it("M-consolidate-store: store-level consolidation bounds growth", async () => {
    const before = (await store.getMemoryEntries()).length;
    const res = await (store as any).consolidateMemories();
    const after = (await store.getMemoryEntries()).length;
    assert.ok(res.total === after && after <= before);
  });
});

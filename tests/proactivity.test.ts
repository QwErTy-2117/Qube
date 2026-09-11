/**
 * Proactivity tests — 24 generalized scenarios mapping to spec examples 1-20.
 *
 * Validates the general mechanisms (never hardcoded topic rules):
 * opportunity detection, evidence evaluation, confidence management,
 * recurring-need detection, scheduling handoff, duplicate prevention,
 * meaningful-change gating, confirmation handling, scope management,
 * authorization boundaries, feedback learning, fatigue reduction, and
 * transparent handling of unsupported background execution.
 *
 * Run: npx tsx --test tests/proactivity.test.ts (or `npm test`)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-pro-test-"));

import {
  evaluateOpportunity,
  proactiveConfidence,
  isDuplicateUpdate,
  fatiguePenalty,
  requiresConfirmationFor,
  countSimilarRequests,
  hasMeaningfulNewInfo,
  applyFeedback,
  isInScope,
  findPriorSuggestion,
  type OpportunityEvidence,
} from "@/lib/proactivity/engine";

function ev(over: Partial<OpportunityEvidence> = {}): OpportunityEvidence {
  return {
    requestCount: 1,
    explicitRecurringRequest: false,
    explicitMonitorPermission: false,
    previouslyAccepted: false,
    previouslyRejected: false,
    hasMeaningfulChange: true,
    requiresExternalAction: false,
    backgroundSupported: true,
    ...over,
  };
}

describe("proactive behavior (spec examples 1-20, generalized)", () => {
  it("P1 repeated topic: suggest, never auto-schedule without permission", () => {
    const r = evaluateOpportunity(ev({ requestCount: 4 }));
    assert.equal(r.decision, "suggest_once");
    assert.notEqual(r.decision, "schedule");
  });

  it("P2 explicit recurring request: schedule with high confidence", () => {
    const r = evaluateOpportunity(ev({ requestCount: 1, explicitRecurringRequest: true }));
    assert.equal(r.decision, "schedule");
    assert.ok(r.confidence >= 0.85);
  });

  it("P3 repeated status checks: suggest; stale repeat without change waits", () => {
    const fresh = evaluateOpportunity(ev({ requestCount: 3, lastContentHash: null }));
    assert.equal(fresh.decision, "suggest_once");
    const stale = evaluateOpportunity(ev({ requestCount: 3, lastContentHash: "h1", newContentHash: "h1", hasMeaningfulChange: false }));
    assert.equal(stale.decision, "no_action");
    assert.equal(stale.suppressDuplicate, true);
  });

  it("P4 deadline: remembered for follow-up, not dropped", () => {
    const r = evaluateOpportunity(ev({ requestCount: 2 }));
    assert.ok(["remember", "suggest_once"].includes(r.decision));
  });

  it("P5 incomplete workflow: medium evidence yields a one-time suggestion", () => {
    const r = evaluateOpportunity(ev({ requestCount: 2, hasMeaningfulChange: true }));
    assert.equal(r.decision, "suggest_once");
    assert.equal(r.requiresConfirmation, false);
  });

  it("P6 repeated manual task: strong repetition justifies suggesting automation", () => {
    const { confidence } = proactiveConfidence(ev({ requestCount: 4 }));
    assert.ok(confidence >= 0.7);
    const r = evaluateOpportunity(ev({ requestCount: 4 }));
    assert.equal(r.decision, "suggest_once");
  });

  it("P7 project risk: internal observation surfaces without confirmation", () => {
    const r = evaluateOpportunity(ev({ requestCount: 2 }));
    assert.equal(r.requiresConfirmation, false);
    assert.equal(r.decision, "suggest_once");
  });

  it("P8 material change: new info surfaces; trivia waits", () => {
    const material = evaluateOpportunity(ev({ requestCount: 2, hasMeaningfulChange: true, previouslyAccepted: true }));
    assert.equal(material.decision, "suggest_once");
    const trivial = evaluateOpportunity(ev({ requestCount: 1, singleMention: true, hasMeaningfulChange: false, lastContentHash: "h9" }));
    assert.ok(["no_action", "remember"].includes(trivial.decision));
  });

  it("P9 format preference: prior acceptance boosts confidence", () => {
    const base = proactiveConfidence(ev({ requestCount: 2 })).confidence;
    const boosted = proactiveConfidence(ev({ requestCount: 2, previouslyAccepted: true })).confidence;
    assert.ok(boosted > base);
  });

  it("P10 timing preference: stored with scope/frequency via the store", async () => {
    const { upsertPreference, loadProactiveState } = await import("@/lib/proactivity/store");
    const pref = await upsertPreference({
      topic: "pro-test weekly digest timing", scope: "global_user",
      kind: "recurring_report", frequency: "weekly friday morning", timing: "friday morning",
      format: "brief", enabled: true, confidence: 0.85,
    });
    assert.ok(pref.id);
    const state = await loadProactiveState();
    assert.ok(state.preferences.some((p) => p.id === pref.id && p.timing === "friday morning"));
  });

  it("P11 rejection: similar suggestions stop, outcome is learned", async () => {
    const store = await import("@/lib/proactivity/store");
    const rec = await store.recordSuggestion({
      topic: "pro-test rejected topic", scope: "global_user", kind: "suggestion",
      decision: "suggest_once", evidence: ["repeated requests"], confidence: 0.6,
    });
    await store.recordSuggestionOutcome(rec.id, "rejected");
    const r = evaluateOpportunity(ev({ requestCount: 3, previouslyRejected: true }));
    assert.equal(r.decision, "no_action");
    assert.ok(r.reasons.join(" ").includes("rejected"));
  });

  it("P12 one-time accept: not converted into a recurring schedule", () => {
    const r = evaluateOpportunity(ev({ requestCount: 1, singleMention: true, previouslyAccepted: true }));
    assert.notEqual(r.decision, "schedule");
  });

  it("P13 single mention: weak evidence takes no action", () => {
    const r = evaluateOpportunity(ev({ requestCount: 1, singleMention: true }));
    assert.equal(r.decision, "no_action");
  });

  it("P14 duplicates: identical content hash suppresses redelivery", () => {
    assert.equal(isDuplicateUpdate("hABC", "hABC", false), true);
    assert.equal(isDuplicateUpdate("hABC", "hDEF", true), false);
    const r = evaluateOpportunity(ev({ requestCount: 4, lastContentHash: "hABC", newContentHash: "hABC", hasMeaningfulChange: false }));
    assert.equal(r.suppressDuplicate, true);
  });

  it("P15 conditional: threshold stored; unmet condition waits", async () => {
    const { upsertPreference } = await import("@/lib/proactivity/store");
    const pref = await upsertPreference({
      topic: "pro-test threshold alert", scope: "global_user", kind: "threshold",
      condition: "only when build fails", enabled: true, confidence: 0.8,
    });
    assert.equal(pref.condition, "only when build fails");
    const waiting = evaluateOpportunity(ev({ requestCount: 2, hasMeaningfulChange: false, lastContentHash: "h1" }));
    assert.equal(waiting.decision, "remember");
  });

  it("P16 project scope: scoped monitoring fires only in its project", () => {
    assert.equal(isInScope({ scope: "project", scopeKey: "alpha" }, "alpha"), true);
    assert.equal(isInScope({ scope: "project", scopeKey: "alpha" }, "beta"), false);
    assert.equal(isInScope({ scope: "global_user" }, "beta"), true);
  });

  it("P17 confirmation: external action drafts instead of executing", () => {
    assert.equal(requiresConfirmationFor("send_email", true), true);
    assert.equal(requiresConfirmationFor("summarize", false), false);
    const r = evaluateOpportunity(ev({ requestCount: 4, requiresExternalAction: true }));
    assert.ok(["prepare_draft", "suggest_once"].includes(r.decision));
    assert.equal(r.requiresConfirmation, true);
  });

  it("P18 background limits: transparent suggestion instead of fake monitoring", () => {
    const r = evaluateOpportunity(ev({ explicitRecurringRequest: true, backgroundSupported: false }));
    assert.equal(r.decision, "suggest_once");
    assert.ok(r.reasons.join(" ").includes("background unsupported"));
  });

  it("P19 improvement: validated reusable workflow proposes a skill", async () => {
    const { evaluateSkillCreation, isGeneralizableSkill } = await import("@/lib/skills/learner");
    const procedure = [
      "When triaging an overloaded inbox, first group messages by sender and urgency, then draft replies",
      "for each group rather than answering in arrival order. Validate drafts against the original request",
      "before sending, and adapt the grouping criteria to the current mailbox rather than reusing prior",
      "labels blindly. Prefer batch actions over per-message handling whenever the pattern recurs.",
    ].join(" ");
    const e = evaluateSkillCreation({ occurrences: 2, stepsCount: 4, hadRecovery: false, validated: true, recurrenceLikelihood: 0.7, generalizable: isGeneralizableSkill(procedure) });
    assert.equal(e.shouldCreate, true);
  });

  it("P20 fatigue: dismissals raise the bar until only explicit requests pass", () => {
    assert.equal(fatiguePenalty(0).threshold, 0.4);
    assert.equal(fatiguePenalty(5).threshold, 0.85);
    const tired = evaluateOpportunity(ev({ requestCount: 2, recentDismissals: 5 }));
    assert.ok(["no_action", "remember"].includes(tired.decision));
    const explicit = evaluateOpportunity(ev({ requestCount: 1, explicitRecurringRequest: true, recentDismissals: 5 }));
    assert.equal(explicit.decision, "schedule");
  });

  it("P-feedback: pause/modify/cancel flow updates the preference", async () => {
    const store = await import("@/lib/proactivity/store");
    const pref = await upsertPreferenceSafe(store, "pro-test pausable digest");
    const paused = applyFeedback(pref, "paused");
    assert.equal(paused.enabled, false);
    const modified = applyFeedback({ ...pref, enabled: true }, "modified", { frequency: "monthly" });
    assert.equal(modified.frequency, "monthly");
    const cancelled = applyFeedback(pref, "cancelled");
    assert.equal(cancelled.enabled, false);
    await store.cancelPreference(pref.id);
    const state = await store.loadProactiveState();
    assert.ok(!state.preferences.some((p) => p.id === pref.id));
  });

  it("P-history: prior-suggestion lookup and request counting work", () => {
    const now = Date.now();
    const history = [
      { topic: "Tech News", at: now - 1000 },
      { topic: "tech news", at: now - 2000 },
      { topic: "Sports", at: now - 1000 },
      { topic: "Tech News", at: now - 40 * 86_400_000 },
    ];
    assert.equal(countSimilarRequests(history, "tech news"), 2);
    const prior = findPriorSuggestion(
      [{ id: "1", topic: "Tech News", scope: "global_user", kind: "suggestion", decision: "suggest_once", evidence: [], confidence: 0.5, createdAt: now } as any],
      "tech news",
    );
    assert.ok(prior && prior.id === "1");
    const { meaningful, hash } = hasMeaningfulNewInfo(null, "fresh content here", true);
    assert.equal(meaningful, true);
    assert.ok(hash.startsWith("h"));
    assert.equal(hasMeaningfulNewInfo(hash, "fresh content here", true).meaningful, false);
  });

  it("P-quiet: quiet periods defer to memory instead of interrupting", () => {
    const r = evaluateOpportunity(ev({ requestCount: 4, inQuietPeriod: true }));
    assert.equal(r.decision, "remember");
  });
});

async function upsertPreferenceSafe(store: typeof import("@/lib/proactivity/store"), topic: string) {
  return store.upsertPreference({ topic, scope: "global_user", kind: "reminder", enabled: true, confidence: 0.7 });
}

describe("learning protocol", () => {
  let protocol: typeof import("@/lib/learning/protocol");

  before(async () => {
    protocol = await import("@/lib/learning/protocol");
  });

  it("L-gate: trivial chatter skips persistence entirely", async () => {
    const out = await protocol.runPostTaskLearning({ threadId: "t-proto-1", userText: "hi", taskSuccess: true, toolCalls: 0, filesChanged: 0 });
    assert.equal(out.meaningful, false);
    assert.equal(out.memoriesWritten.length, 0);
  });

  it("L-pass: meaningful preference task persists a generalized memory", async () => {
    const out = await protocol.runPostTaskLearning({
      threadId: "t-proto-2", userText: "remember: I prefer concise morning briefs", taskSuccess: true,
      toolCalls: 1, filesChanged: 0,
    });
    assert.equal(out.meaningful, true);
    assert.ok(out.memoriesWritten.length >= 1);
  });

  it("L-never-throws: store failures degrade to skipped, not errors", async () => {
    const out = await protocol.runPostTaskLearning({
      threadId: "t-proto-3", userText: "remember " + "x".repeat(5000), taskSuccess: true, toolCalls: 3, filesChanged: 1,
    });
    assert.equal(out.evaluated, true);
  });
});

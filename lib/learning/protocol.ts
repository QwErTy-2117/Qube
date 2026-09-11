/**
 * Learning protocol — explicit post-task pass (§§4,5,22).
 *
 * Runs at task completion (all goals complete), before the final response:
 *
 *   TASK COMPLETION CHECK -> achieved? -> what worked/failed/learned?
 *   -> what persists? -> generalize? -> preference? -> reusable procedure?
 *   -> skill create/update? -> recurring need? -> proactivity justified?
 *   -> least-intrusive response? -> confirm needed? -> store/update -> answer
 *
 * Efficient by design (§29): cheap heuristic gate first; expensive work
 * (LLM extraction) only when the gate passes. Deterministic parts live in
 * lib/memory/learning.ts and lib/skills/learner.ts; this module orchestrates
 * persistence + observability + scheduler handoff.
 */

import { isMeaningfulTask, generalizeContent, inferPreference, detectFollowupOpportunity } from "@/lib/memory/learning";
import { evaluateSkillCreation, isGeneralizableSkill } from "@/lib/skills/learner";
import { evaluateOpportunity } from "@/lib/proactivity/engine";

export interface TaskSummary {
  threadId: string;
  userText: string;
  taskSuccess: boolean;
  toolCalls: number;
  filesChanged: number;
  /** Short description of what worked (for lesson extraction). */
  whatWorked?: string;
  /** Short description of failure + recovery (for lesson extraction). */
  whatFailed?: string;
  /** Recurring-need signals observed (topic request counts). */
  requestCounts?: Record<string, number>;
  /** Active project/workspace key for scoping. */
  scopeKey?: string;
  /** Whether the app can run background work (scheduler available). */
  backgroundSupported?: boolean;
}

export interface LearningOutcome {
  evaluated: boolean;
  meaningful: boolean;
  memoriesWritten: Array<{ id: string; category: string }>;
  skillsProposed: Array<{ name: string; reason: string }>;
  proactiveDecision?: string;
  proactiveReasons?: string[];
  skippedReason?: string;
}

/**
 * Lightweight synchronous gate + async persistence.
 * Never throws — learning is non-fatal to the user response.
 */
export async function runPostTaskLearning(summary: TaskSummary): Promise<LearningOutcome> {
  const empty: LearningOutcome = { evaluated: true, meaningful: false, memoriesWritten: [], skillsProposed: [], skippedReason: "not meaningful" };
  try {
    const meaningful = isMeaningfulTask({
      toolCalls: summary.toolCalls,
      filesChanged: summary.filesChanged,
      userText: summary.userText,
      taskSuccess: summary.taskSuccess,
    });
    if (!meaningful) return empty;

    const { logEvent, logMemoryWritten, logProactiveEvent } = await import("@/lib/agent/observability");
    const memoriesWritten: Array<{ id: string; category: string }> = [];
    const skillsProposed: Array<{ name: string; reason: string }> = [];

    // 1) Preference / durable context extraction (generalized, confidence-weighted).
    try {
      const candidate = inferPreference(summary.userText);
      if (candidate) {
        const { generalized } = generalizeContent(candidate.content);
        const { checkPersistable, sanitizeCategory } = await import("@/lib/memory/safety");
        const gate = checkPersistable(generalized);
        if (gate.ok) {
          const mem = await import("@/lib/memory/memory-store");
          const category = sanitizeCategory(candidate.memoryType === "preference" ? "preference" : candidate.memoryType === "explicit" ? "personal" : "general");
          // Avoid duplicates: skip when near-identical content already stored.
          const existing = await mem.getMemoryEntries().catch(() => []);
          const dup = existing.some((e: any) => e.content.toLowerCase().trim() === generalized.toLowerCase().trim());
          if (!dup) {
            const entry = await (mem as any).addMemoryEntryExt
              ? await (mem as any).addMemoryEntryExt(category, generalized, {
                  confidence: candidate.confidence,
                  importance: candidate.importance,
                  memoryType: candidate.memoryType,
                  scope: candidate.scope,
                  topics: candidate.topics,
                  confirmation: candidate.confirmation,
                  provenance: `post-task:${summary.threadId}`,
                  sourceConversation: summary.threadId,
                })
              : await mem.addMemoryEntry(category, generalized, 0.6, candidate.confidence);
            memoriesWritten.push({ id: (entry as any).id, category });
            await logMemoryWritten(summary.threadId, (entry as any).id, category, `post-task preference (${candidate.reason})`).catch(() => {});
          }
        } else {
          await logEvent({ threadId: summary.threadId, type: "memory_suppressed", reason: gate.reason }).catch(() => {});
        }
      }
    } catch {}

    // 2) Failure lesson: generalize the recovery, don't store the raw incident.
    try {
      if (summary.whatFailed && summary.whatWorked) {
        const lesson = `Recovery that worked: ${summary.whatWorked.slice(0, 200)}. Context: ${summary.whatFailed.slice(0, 200)}`;
        const { generalized } = generalizeContent(lesson);
        const { checkPersistable } = await import("@/lib/memory/safety");
        if (checkPersistable(generalized).ok) {
          const mem = await import("@/lib/memory/memory-store");
          const existing = await mem.getMemoryEntries().catch(() => []);
          const dup = existing.some((e: any) => e.content.toLowerCase().includes(generalized.toLowerCase().slice(0, 60)));
          if (!dup) {
            const entry = await (mem as any).addMemoryEntryExt
              ? await (mem as any).addMemoryEntryExt("general", generalized.slice(0, 500), {
                  confidence: 0.6,
                  importance: 0.65,
                  memoryType: "lesson_failure",
                  provenance: `post-task:${summary.threadId}`,
                  sourceConversation: summary.threadId,
                })
              : await mem.addMemoryEntry("general", generalized.slice(0, 500), 0.6, 0.6);
            memoriesWritten.push({ id: (entry as any).id, category: "general" });
          }
        }
      }
    } catch {}

    // 3) Skill proposal: only when procedural + reusable + generalizable.
    try {
      if (summary.whatWorked && summary.toolCalls >= 3) {
        const evalRes = evaluateSkillCreation({
          occurrences: 1,
          stepsCount: summary.toolCalls,
          hadRecovery: Boolean(summary.whatFailed),
          validated: summary.taskSuccess,
          recurrenceLikelihood: summary.toolCalls >= 4 ? 0.6 : 0.4,
          generalizable: isGeneralizableSkill(summary.whatWorked),
        });
        if (evalRes.shouldCreate) {
          const name = `learned-${Date.now().toString(36)}`;
          skillsProposed.push({ name, reason: evalRes.reasons.join("; ") });
          await logEvent({ threadId: summary.threadId, type: "skill_candidate", metadata: { name, reasons: evalRes.reasons } } as any).catch(() => {});
        }
      }
    } catch {}

    // 4) Proactivity evaluation: recurring need or follow-up opportunity?
    let proactiveDecision: string | undefined;
    let proactiveReasons: string[] | undefined;
    try {
      const followup = detectFollowupOpportunity(summary.userText);
      const counts = summary.requestCounts || {};
      const topTopic = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (followup || (topTopic && topTopic[1] >= 2)) {
        const topic = followup?.topic || topTopic![0];
        const requestCount = topTopic ? topTopic[1] : 1;
        const state = await import("@/lib/proactivity/store").then((m) => m.loadProactiveState()).catch(() => null);
        const prior = state?.suggestions.find((s: any) => s.topic.toLowerCase().slice(0, 80) === topic.toLowerCase().slice(0, 80));
        const evalRes = evaluateOpportunity({
          requestCount,
          explicitRecurringRequest: /\b(every|daily|weekly|remind me|notify me)\b/i.test(summary.userText),
          explicitMonitorPermission: false,
          previouslyAccepted: prior?.outcome === "accepted" || prior?.outcome === "accepted_once",
          previouslyRejected: prior?.outcome === "rejected" || prior?.outcome === "dismissed",
          hasMeaningfulChange: true,
          requiresExternalAction: false,
          backgroundSupported: summary.backgroundSupported ?? true,
          scopeKey: summary.scopeKey,
          recentDismissals: state?.recentDismissals.length ?? 0,
          singleMention: requestCount <= 1 && !followup,
        });
        proactiveDecision = evalRes.decision;
        proactiveReasons = evalRes.reasons;
        if (evalRes.decision === "remember" || evalRes.decision === "suggest_once") {
          await logProactiveEvent(summary.threadId, "detected", topic.slice(0, 160), evalRes.reasons.join("; "), { decision: evalRes.decision }).catch(() => {});
        }
      }
    } catch {}

    await logEvent({ threadId: summary.threadId, type: "learning_pass", metadata: { meaningful: true, memories: memoriesWritten.length, skills: skillsProposed.length, proactiveDecision } } as any).catch(() => {});
    return { evaluated: true, meaningful: true, memoriesWritten, skillsProposed, proactiveDecision, proactiveReasons };
  } catch (e: any) {
    return { evaluated: true, meaningful: false, memoriesWritten: [], skillsProposed: [], skippedReason: `learning error: ${e?.message || String(e)}` };
  }
}

/**
 * Heartbeat decision helper — wires the proactivity engine (audit fix #4)
 * into the heartbeat recording path.
 *
 * Before: heartbeat findings were recorded ad-hoc by LLM judgment against
 * weak prompt examples. The engine's confidence / duplicate / fatigue / scope
 * ladder (lib/proactivity/engine.ts) was dead code — nothing called it.
 *
 * After: every heartbeat finding is scored here first. Duplicates and
 * below-bar candidates are suppressed with a reason; the rest proceed to the
 * checklist + suggestion stores. Pure + store-backed, never throws.
 */

import {
  evaluateOpportunity,
  countSimilarRequests,
  hasMeaningfulNewInfo,
  fatiguePenalty,
  type OpportunityEvidence,
} from "./engine";
import { hashContent } from "./store";

export interface FindingSignal {
  topic: string;
  detail: string;
  evidence?: string[];
  /** e.g. repeated request count evidence, explicit monitor permission. */
  requestCount?: number;
  explicitMonitorPermission?: boolean;
  requiresExternalAction?: boolean;
  scopeKey?: string;
}

export interface FindingDecision {
  proceed: boolean;
  decision: string;
  confidence: number;
  reasons: string[];
  duplicate: boolean;
  contentHash: string;
}

function normTopic(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Score a heartbeat finding via the engine. Reads proactive state. */
export async function decideHeartbeatFinding(sig: FindingSignal): Promise<FindingDecision> {
  const topic = sig.topic.slice(0, 200).trim() || "Heartbeat finding";
  const detail = sig.detail.slice(0, 500);
  const contentHash = hashContent(`${topic} :: ${detail}`.toLowerCase().slice(0, 2000));
  try {
    const store = await import("./store");
    const state = await store.loadProactiveState().catch(() => null);
    const suggestions = state?.suggestions || [];
    const history = suggestions.map((s: any) => ({ topic: String(s.topic || ""), at: s.createdAt || 0 }));

    // Duplicate: same fingerprint already pending/delivered without change.
    const norm = normTopic(topic);
    const dupe = suggestions.find((s: any) => {
      if (normTopic(String(s.topic || "")) !== norm) return false;
      if (s.contentHash === contentHash) return true;
      if (!s.outcome && Date.now() - (s.createdAt || 0) < 7 * 86_400_000) return true;
      return false;
    });
    if (dupe) {
      return { proceed: false, decision: "no_action", confidence: 0.1, reasons: ["duplicate of pending/delivered finding — suppress"], duplicate: true, contentHash };
    }

    const requestCount = sig.requestCount ?? Math.max(1, countSimilarRequests(history, topic));
    const recentDismissals = (state?.recentDismissals || []).filter((t: number) => Date.now() - t < 7 * 86_400_000).length;
    const rejectedTopics = new Set(
      suggestions.filter((s: any) => ["rejected", "dismissed", "ignored", "cancelled"].includes(s.outcome)).map((s: any) => normTopic(String(s.topic || ""))),
    );
    const previouslyRejected = rejectedTopics.has(norm);
    const previouslyAccepted = suggestions.some((s: any) => normTopic(String(s.topic || "")) === norm && ["accepted", "accepted_once"].includes(s.outcome));
    const lastDelivered = [...suggestions].reverse().find((s: any) => normTopic(String(s.topic || "")) === norm && s.contentHash);
    const { meaningful } = hasMeaningfulNewInfo(
      lastDelivered?.contentHash || null,
      `${topic} :: ${detail}`,
      true,
    );

    const ev: OpportunityEvidence = {
      requestCount,
      explicitRecurringRequest: false,
      // The heartbeat IS an authorized monitor (user enabled it), so its
      // findings carry monitor permission — fresh facts notify once. Only
      // duplicates and previously-rejected topics are suppressed below.
      explicitMonitorPermission: sig.explicitMonitorPermission ?? true,
      previouslyAccepted,
      previouslyRejected,
      hasMeaningfulChange: meaningful,
      newContentHash: contentHash,
      lastContentHash: lastDelivered?.contentHash || null,
      requiresExternalAction: sig.requiresExternalAction ?? false,
      backgroundSupported: true,
      scopeKey: sig.scopeKey,
      recentDismissals,
    };
    const evaled = evaluateOpportunity(ev);
    // Suppression cases: exact duplicate, or the user rejected this topic.
    // Low confidence alone must NOT silence a fresh authorized-monitor
    // finding — that would kill exactly the new-email/new-file discoveries
    // the heartbeat exists for. Map those to notify-once instead.
    if (evaled.decision === "no_action" && previouslyRejected) {
      return { proceed: false, decision: evaled.decision, confidence: evaled.confidence, reasons: [...evaled.reasons, "topic previously rejected — do not re-surface"], duplicate: false, contentHash };
    }
    if (evaled.decision === "no_action") {
      return { proceed: true, decision: "suggest_once", confidence: evaled.confidence, reasons: [...evaled.reasons, "authorized monitor — fresh finding notifies once"], duplicate: false, contentHash };
    }
    const proceed = true;
    const reasons = [...evaled.reasons];
    if (!meaningful && lastDelivered?.contentHash) reasons.push("no meaningful change vs last delivery");
    void fatiguePenalty;
    return { proceed, decision: evaled.decision, confidence: evaled.confidence, reasons, duplicate: false, contentHash };
  } catch {
    // Fail open: a scoring error must never drop a genuine finding.
    return { proceed: true, decision: "suggest_once", confidence: 0.5, reasons: ["scoring unavailable — fail open"], duplicate: false, contentHash };
  }
}

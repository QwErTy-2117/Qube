/**
 * Proactivity engine — evidence-based, least-intrusive assistance (§§15-20).
 *
 * Central principle: infer possible future usefulness from evidence, evaluate
 * whether benefit justifies interruption, choose the least intrusive response.
 *
 * Decision ladder:
 *   no_action -> remember -> suggest_once -> prepare_draft -> ask_confirm
 *   -> schedule -> execute_low_risk
 *
 * General mechanisms (never hardcoded topic rules):
 * - evidence scoring + confidence levels
 * - recurring-need detection (repeated requests, not single mentions)
 * - duplicate prevention (content hash + meaningful-change gate)
 * - notification-fatigue backoff (recent dismissals raise the bar)
 * - scope management (project-scoped prefs stay project-scoped)
 * - authorization checks (external side effects need confirmation)
 * - feedback learning (accept/reject/pause/modify/cancel)
 */

import type { ProactiveDecision, ProactivePreference, SuggestionRecord } from "./store";
import { hashContent } from "./store";

export interface OpportunityEvidence {
  /** Repeated requests for similar information (count across sessions). */
  requestCount: number;
  /** Explicit recurring request ("every Friday send me..."). */
  explicitRecurringRequest: boolean;
  /** Explicit permission to monitor/notify. */
  explicitMonitorPermission: boolean;
  /** User previously accepted similar suggestions. */
  previouslyAccepted: boolean;
  /** User previously rejected/ignored similar suggestions. */
  previouslyRejected: boolean;
  /** Days since last delivery of similar content. */
  daysSinceLastDelivery?: number;
  /** Is there materially new information vs last delivery? */
  hasMeaningfulChange: boolean;
  /** New content hash for duplicate comparison. */
  newContentHash?: string | null;
  /** Last delivered content hash. */
  lastContentHash?: string | null;
  /** Would the action create an external side effect? */
  requiresExternalAction: boolean;
  /** Is the app capable of background execution for this? */
  backgroundSupported: boolean;
  /** Active project scope key, if any. */
  scopeKey?: string;
  /** Preference scope for this opportunity. */
  scope?: string;
  /** Recent dismissal count (fatigue signal). */
  recentDismissals?: number;
  /** In quiet period (user paused / do-not-disturb)? */
  inQuietPeriod?: boolean;
  /** Single weak mention vs established pattern? */
  singleMention?: boolean;
}

export interface ProactiveEvaluation {
  decision: ProactiveDecision;
  confidence: number;
  reasons: string[];
  requiresConfirmation: boolean;
  suppressDuplicate: boolean;
}

/** Confidence model (§17). */
export function proactiveConfidence(e: OpportunityEvidence): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let c = 0.15;
  if (e.explicitRecurringRequest) {
    c = Math.max(c, 0.9);
    reasons.push("explicit recurring request");
  }
  if (e.explicitMonitorPermission) {
    c = Math.max(c, 0.88);
    reasons.push("explicit monitor permission");
  }
  if (e.requestCount >= 4) {
    c = Math.max(c, 0.78);
    reasons.push(`repeated requests x${e.requestCount}`);
  } else if (e.requestCount === 3) {
    c = Math.max(c, 0.65);
    reasons.push("3 similar requests");
  } else if (e.requestCount === 2) {
    c = Math.max(c, 0.5);
    reasons.push("2 similar requests");
  } else if ((e.singleMention || e.requestCount <= 1) && !e.explicitRecurringRequest && !e.explicitMonitorPermission) {
    c = Math.min(c, 0.25);
    reasons.push("single mention — weak evidence");
  }
  if (e.previouslyAccepted && !e.previouslyRejected) {
    c = Math.min(0.92, c + 0.12);
    reasons.push("previously accepted");
  }
  if (e.previouslyRejected) {
    c = Math.max(0.05, c - 0.35);
    reasons.push("previously rejected — penalized");
  }
  if (!e.hasMeaningfulChange) {
    c = Math.max(0.05, c - 0.2);
    reasons.push("no meaningful change");
  }
  return { confidence: Math.min(0.95, Math.max(0.05, c)), reasons };
}

/** Duplicate gate (§20 ex.14): same hash + no change => suppress. */
export function isDuplicateUpdate(lastHash: string | null | undefined, newHash: string | null | undefined, hasMeaningfulChange: boolean): boolean {
  if (!lastHash || !newHash) return false;
  if (lastHash === newHash) return true;
  return !hasMeaningfulChange && lastHash.slice(0, 10) === newHash.slice(0, 10);
}

/** Fatigue: recent dismissals raise the evidence bar (§20 ex.20). */
export function fatiguePenalty(recentDismissals: number): { threshold: number; note: string } {
  if (recentDismissals >= 5) return { threshold: 0.85, note: "heavy fatigue — only explicit requests pass" };
  if (recentDismissals >= 3) return { threshold: 0.7, note: "moderate fatigue — high bar" };
  if (recentDismissals >= 1) return { threshold: 0.55, note: "light fatigue — raised bar" };
  return { threshold: 0.4, note: "no fatigue" };
}

/** Authorization: consequential external actions always need confirmation (§19). */
export function requiresConfirmationFor(kind: string, requiresExternalAction: boolean): boolean {
  if (!requiresExternalAction) return false;
  const externalKinds = ["send", "publish", "purchase", "delete", "modify", "contact", "schedule_meeting", "share_private", "external"];
  return externalKinds.some((k) => kind.toLowerCase().includes(k)) || requiresExternalAction;
}

export function evaluateOpportunity(e: OpportunityEvidence): ProactiveEvaluation {
  const reasons: string[] = [];
  const { confidence, reasons: cReasons } = proactiveConfidence(e);
  reasons.push(...cReasons);

  // Hard gates first (ordered by intrusiveness).
  if (e.inQuietPeriod) {
    return { decision: "remember", confidence, reasons: [...reasons, "quiet period — defer"], requiresConfirmation: false, suppressDuplicate: false };
  }
  if (e.previouslyRejected && !e.explicitRecurringRequest && confidence < 0.6) {
    return { decision: "no_action", confidence, reasons: [...reasons, "user rejected similar — do not re-suggest"], requiresConfirmation: false, suppressDuplicate: false };
  }
  if (e.singleMention && !e.explicitRecurringRequest && e.requestCount <= 1) {
    return { decision: "no_action", confidence, reasons: [...reasons, "single mention is not a recurring need"], requiresConfirmation: false, suppressDuplicate: false };
  }
  if (e.newContentHash && isDuplicateUpdate(e.lastContentHash, e.newContentHash, e.hasMeaningfulChange)) {
    return { decision: "no_action", confidence, reasons: [...reasons, "duplicate of last delivery — suppress"], requiresConfirmation: false, suppressDuplicate: true };
  }
  if (!e.hasMeaningfulChange && !e.explicitRecurringRequest && e.lastContentHash) {
    return { decision: "remember", confidence, reasons: [...reasons, "no new information — wait"], requiresConfirmation: false, suppressDuplicate: true };
  }
  if (!e.backgroundSupported && (e.explicitRecurringRequest || e.explicitMonitorPermission)) {
    // §20 ex.18: be transparent, offer supported alternative.
    return { decision: "suggest_once", confidence, reasons: [...reasons, "background unsupported — suggest manual alternative instead of pretending to monitor"], requiresConfirmation: true, suppressDuplicate: false };
  }

  const { threshold, note } = fatiguePenalty(e.recentDismissals ?? 0);
  reasons.push(note);
  if (confidence < threshold && !e.explicitRecurringRequest) {
    const decision = confidence < 0.3 ? "no_action" : "remember";
    return { decision, confidence, reasons: [...reasons, `below fatigue-adjusted threshold ${threshold}`], requiresConfirmation: false, suppressDuplicate: false };
  }

  const needsConfirm = requiresConfirmationFor("external", e.requiresExternalAction);

  // Least-intrusive ladder by confidence.
  if (e.explicitRecurringRequest && e.backgroundSupported && !needsConfirm) {
    return { decision: "schedule", confidence, reasons: [...reasons, "explicit recurring request — schedule"], requiresConfirmation: false, suppressDuplicate: false };
  }
  if (e.explicitRecurringRequest && needsConfirm) {
    return { decision: "ask_confirm", confidence, reasons: [...reasons, "recurring request needs confirmation for external action"], requiresConfirmation: true, suppressDuplicate: false };
  }
  if (confidence >= 0.75) {
    return needsConfirm
      ? { decision: "prepare_draft", confidence, reasons: [...reasons, "high confidence but external — draft + confirm"], requiresConfirmation: true, suppressDuplicate: false }
      : { decision: "suggest_once", confidence, reasons: [...reasons, "high confidence — one-time suggestion"], requiresConfirmation: false, suppressDuplicate: false };
  }
  if (confidence >= 0.5) {
    return { decision: "suggest_once", confidence, reasons: [...reasons, "medium confidence — offer, do not auto-schedule"], requiresConfirmation: needsConfirm, suppressDuplicate: false };
  }
  if (confidence >= 0.3) {
    return { decision: "remember", confidence, reasons: [...reasons, "low-medium — remember opportunity for later"], requiresConfirmation: false, suppressDuplicate: false };
  }
  return { decision: "no_action", confidence, reasons, requiresConfirmation: false, suppressDuplicate: false };
}

/** Count similar past requests for recurring-need detection (case-insensitive topic match). */
export function countSimilarRequests(history: Array<{ topic: string; at: number }>, topic: string, windowDays = 30): number {
  const now = Date.now();
  const norm = topic.toLowerCase().slice(0, 80);
  return history.filter((h) => Date.now() && now - h.at < windowDays * 86_400_000 && h.topic.toLowerCase().slice(0, 80) === norm).length;
}

/** Meaningful-change gate: content hash differs AND caller asserts material change. */
export function hasMeaningfulNewInfo(lastHash: string | null | undefined, newContent: string, assertedChange: boolean): { meaningful: boolean; hash: string } {
  const hash = hashContent(newContent);
  if (!lastHash) return { meaningful: assertedChange, hash };
  if (lastHash === hash) return { meaningful: false, hash };
  return { meaningful: assertedChange, hash };
}

/** Apply user feedback (§§8,20): accept/reject/pause/modify/cancel. */
export function applyFeedback(
  pref: ProactivePreference,
  outcome: "accepted" | "rejected" | "paused" | "cancelled" | "modified",
  patch?: Partial<ProactivePreference>,
): ProactivePreference {
  const next = { ...pref, updatedAt: Date.now() };
  switch (outcome) {
    case "accepted":
      next.enabled = true;
      next.confidence = Math.min(0.95, next.confidence + 0.1);
      break;
    case "rejected":
      next.enabled = false;
      next.confidence = Math.max(0.05, next.confidence - 0.3);
      break;
    case "paused":
      next.enabled = false;
      break;
    case "cancelled":
      next.enabled = false;
      next.confidence = 0.05;
      break;
    case "modified":
      Object.assign(next, patch || {});
      break;
  }
  return next;
}

/** Scope check (§20 ex.16): a project-scoped pref must not fire for other projects. */
export function isInScope(pref: Pick<ProactivePreference, "scope" | "scopeKey">, activeScopeKey?: string): boolean {
  if (pref.scope === "global_user") return true;
  if (!pref.scopeKey) return true;
  return pref.scopeKey === activeScopeKey;
}

/** Filter suggestion history for "already suggested/completed/dismissed/scheduled" checks. */
export function findPriorSuggestion(suggestions: SuggestionRecord[], topic: string, scopeKey?: string): SuggestionRecord | null {
  const norm = topic.toLowerCase().slice(0, 80);
  const matches = suggestions.filter(
    (s) => s.topic.toLowerCase().slice(0, 80) === norm && (scopeKey === undefined || (s.scopeKey || "") === scopeKey),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.createdAt - a.createdAt)[0];
}

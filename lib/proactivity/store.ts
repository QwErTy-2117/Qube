/**
 * Proactivity store — durable proactive preferences, suggestion history,
 * schedules, quiet periods, and delivery state.
 *
 * Persists to .memory/proactive.json (same data-dir pattern as scheduler).
 * Reuses the scheduler for exact-timing work; this store owns the
 * *decision state*: what was suggested/accepted/rejected/scheduled,
 * when it was last delivered, and fatigue counters.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export type ProactiveActionKind = "suggestion" | "draft" | "scheduled" | "executed" | "remembered";
export type ProactiveDecision = "no_action" | "remember" | "suggest_once" | "prepare_draft" | "ask_confirm" | "schedule" | "execute_low_risk";
export type SuggestionOutcome = "accepted" | "accepted_once" | "rejected" | "ignored" | "dismissed" | "paused" | "cancelled" | "modified";

export interface ProactivePreference {
  id: string;
  topic: string;
  scope: string;
  scopeKey?: string;
  /** e.g. daily tech digest, deadline reminder, threshold alert. */
  kind: "recurring_report" | "reminder" | "monitor" | "threshold" | "followup";
  frequency?: string;
  timing?: string;
  format?: string;
  /** Only send when this condition holds (threshold/event/change). */
  condition?: string;
  enabled: boolean;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  lastDeliveredAt?: number | null;
  /** Hash of last delivered content for duplicate prevention. */
  lastContentHash?: string | null;
}

export interface SuggestionRecord {
  id: string;
  topic: string;
  scope: string;
  scopeKey?: string;
  kind: ProactiveActionKind;
  decision: ProactiveDecision;
  evidence: string[];
  confidence: number;
  createdAt: number;
  outcome?: SuggestionOutcome;
  outcomeAt?: number | null;
  contentHash?: string | null;
}

export interface ProactiveState {
  version: number;
  preferences: ProactivePreference[];
  suggestions: SuggestionRecord[];
  /** Low-value suggestion dismissals drive fatigue backoff. */
  recentDismissals: number[];
  quietUntil?: number | null;
  backgroundSupported: boolean;
}

const FILE = () => join(getDataDir(), ".memory", "proactive.json");

function defaults(): ProactiveState {
  return { version: 1, preferences: [], suggestions: [], recentDismissals: [], quietUntil: null, backgroundSupported: true };
}

async function ensureDir() {
  const dir = join(getDataDir(), ".memory");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export async function loadProactiveState(): Promise<ProactiveState> {
  await ensureDir();
  if (!existsSync(FILE())) return defaults();
  try {
    const raw = await readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

export async function saveProactiveState(state: ProactiveState): Promise<void> {
  await ensureDir();
  await writeFile(FILE(), JSON.stringify(state, null, 2), "utf-8");
}

export async function upsertPreference(p: Omit<ProactivePreference, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<ProactivePreference> {
  const state = await loadProactiveState();
  const now = Date.now();
  if (p.id) {
    const existing = state.preferences.find((x) => x.id === p.id);
    if (existing) {
      Object.assign(existing, p, { updatedAt: now });
      await saveProactiveState(state);
      return existing;
    }
  }
  // Dedupe: same topic+scope+kind merges rather than duplicates.
  const twin = state.preferences.find(
    (x) => x.topic.toLowerCase() === p.topic.toLowerCase() && x.scope === p.scope && x.kind === p.kind && (x.scopeKey || "") === (p.scopeKey || ""),
  );
  if (twin) {
    Object.assign(twin, p, { id: twin.id, createdAt: twin.createdAt, updatedAt: now });
    await saveProactiveState(state);
    return twin;
  }
  const created: ProactivePreference = {
    ...p,
    id: p.id || `pro_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
  };
  state.preferences.push(created);
  await saveProactiveState(state);
  return created;
}

export async function recordSuggestion(s: Omit<SuggestionRecord, "id" | "createdAt">): Promise<SuggestionRecord> {
  const state = await loadProactiveState();
  const rec: SuggestionRecord = { ...s, id: `sug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, createdAt: Date.now() };
  state.suggestions.push(rec);
  // Bound history: keep last 200.
  if (state.suggestions.length > 200) state.suggestions = state.suggestions.slice(-200);
  await saveProactiveState(state);
  return rec;
}

export async function recordSuggestionOutcome(id: string, outcome: SuggestionOutcome): Promise<void> {
  const state = await loadProactiveState();
  const rec = state.suggestions.find((s) => s.id === id);
  if (!rec) return;
  rec.outcome = outcome;
  rec.outcomeAt = Date.now();
  if (outcome === "rejected" || outcome === "dismissed" || outcome === "ignored") {
    state.recentDismissals.push(Date.now());
    state.recentDismissals = state.recentDismissals.filter((t) => Date.now() - t < 7 * 86_400_000).slice(-20);
  }
  await saveProactiveState(state);
}

export async function setPreferenceEnabled(id: string, enabled: boolean): Promise<ProactivePreference | null> {
  const state = await loadProactiveState();
  const p = state.preferences.find((x) => x.id === id);
  if (!p) return null;
  p.enabled = enabled;
  p.updatedAt = Date.now();
  await saveProactiveState(state);
  return p;
}

export async function cancelPreference(id: string): Promise<boolean> {
  const state = await loadProactiveState();
  const before = state.preferences.length;
  state.preferences = state.preferences.filter((x) => x.id !== id);
  if (state.preferences.length === before) return false;
  await saveProactiveState(state);
  return true;
}

export function hashContent(content: string): string {
  let h = 0;
  const s = content.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 2000);
  for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) >>> 0) % 1_000_000_007;
  return `h${h.toString(36)}_l${s.length}`;
}

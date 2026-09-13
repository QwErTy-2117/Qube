/**
 * Context compaction for the Pi harness.
 *
 * Modeled on the converged pattern used by opencode, Pi (earendil-works),
 * OpenClaw, and Claude Code:
 *
 *  1. Size-triggered — before each model call, estimate the full request
 *     (system prompt + summary + messages) in tokens. When it exceeds
 *     `contextTokens - reserveTokens`, compact.
 *  2. Turn-boundary cut — walk back from the newest message, keeping up to
 *     `keepRecentTokens` verbatim. The cut lands on a user-message boundary
 *     so tool-call/result pairs inside a message are never split.
 *  3. Structured LLM summary — the older head is serialized to text (tool
 *     outputs truncated, media reduced to placeholders) and summarized with
 *     a fixed template. A previous summary is passed as iterative context so
 *     repeated compactions update one anchored summary instead of stacking.
 *  4. Durable checkpoint — the summary + an anchor hash of the first kept
 *     message persist per thread. The client resends full history every turn,
 *     so each request re-applies the checkpoint (dropping the already-
 *     summarized head) without a new LLM call until the window fills again.
 *  5. Overflow recovery — provider context-overflow errors trigger one
 *     aggressive compaction + retry per turn.
 *
 * Compaction is lossy but never deletes durable history: thread snapshots
 * and session transcripts on disk keep the full conversation; only what the
 * model sees on the next turn is reduced.
 */

import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export type UiMessage = Record<string, unknown>;

// ---------- Config (env-overridable, read lazily so tests can override) ----------

export type CompactionConfig = {
  enabled: boolean;
  /** Assumed model context window when the provider reports none. */
  contextTokens: number;
  /** Headroom below the window: compaction triggers at context - reserve. */
  reserveTokens: number;
  /** Recent history kept verbatim beside the summary. */
  keepRecentTokens: number;
  /** Cap on the summary generation output. */
  summaryMaxOutputTokens: number;
  /** Per tool-output truncation when serializing history for the summary. */
  toolOutputMaxChars: number;
};

export function getCompactionConfig(): CompactionConfig {
  const num = (v: string | undefined, dflt: number): number => {
    const n = parseInt(v || "", 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return {
    enabled: process.env.QUBE_COMPACTION_ENABLED !== "false",
    contextTokens: num(process.env.QUBE_COMPACTION_CONTEXT_TOKENS, 128_000),
    reserveTokens: num(process.env.QUBE_COMPACTION_RESERVE_TOKENS, 20_000),
    keepRecentTokens: num(process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS, 15_000),
    summaryMaxOutputTokens: num(process.env.QUBE_COMPACTION_SUMMARY_TOKENS, 4096),
    toolOutputMaxChars: num(process.env.QUBE_COMPACTION_TOOL_CHARS, 2000),
  };
}

/** Effective kill-switch: env flag AND app settings (default ON). */
export function isCompactionEnabled(): boolean {
  if (process.env.QUBE_COMPACTION_ENABLED === "false") return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { settingsStore } = require("@/lib/settings-store") as typeof import("@/lib/settings-store");
    if (settingsStore.getAll().compactionEnabled === false) return false;
  } catch {}
  return true;
}

// ---------- Token estimation (chars/4 heuristic, same as voicemem-core) ----------

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ---------- Serialization: UIMessages -> summary-source text ----------

function partText(p: any): string {
  if (!p || typeof p !== "object") return "";
  if (typeof p.text === "string" && p.text) return p.text;
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated ${s.length - max} chars]`;
}

/** Render one tool part for the summary source (bounded, text-only). */
function serializeToolPart(p: any, toolChars: number): string {
  const name = p.toolName || p.name || "tool";
  // Tool call: name + compact args, never the full output.
  if (p.type === "tool-call" || p.type === "dynamic-tool-call" || p.input !== undefined) {
    let args = "";
    try {
      const raw = p.args ?? p.input ?? {};
      args = JSON.stringify(raw);
      if (args.length > 500) args = args.slice(0, 500) + "...";
    } catch {
      args = "";
    }
    return `[tool call: ${name}${args && args !== "{}" ? ` ${args}` : ""}]`;
  }
  // Tool result / output: bounded text.
  const out = p.output ?? p.result ?? p.content ?? p.errorText ?? "";
  let text = "";
  if (typeof out === "string") text = out;
  else if (Array.isArray(out)) text = out.map((o: any) => (typeof o === "string" ? o : o?.text || JSON.stringify(o) || "")).join("\n");
  else if (out && typeof out === "object") {
    try {
      text = JSON.stringify(out);
    } catch {
      text = String(out);
    }
  } else if (out != null) text = String(out);
  if (p.type === "file" || p.mime || p.mediaType) {
    const mime = p.mime || p.mediaType || "file";
    const fname = p.filename || p.name || "attachment";
    return `[Attached ${mime}: ${fname}]`;
  }
  return `[tool result: ${name}]\n${truncate(text.trim(), toolChars)}`;
}

export function serializeUiMessage(m: UiMessage, toolChars: number): string {
  const role = typeof m.role === "string" ? m.role : "unknown";
  const lines: string[] = [];
  const parts: any = (m as any).parts ?? (m as any).content;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (!p || typeof p !== "object") continue;
      const t = (p as any).type as string | undefined;
      if (t === "text" || typeof (p as any).text === "string") {
        const tx = partText(p).trim();
        if (tx) lines.push(tx);
      } else if (t === "reasoning" || t === "reasoning-start" || t === "reasoning-delta" || t === "reasoning-end") {
        // Reasoning chains rot fastest — keep a short trace only.
        const tx = partText(p).trim();
        if (tx) lines.push(`[reasoning] ${truncate(tx, 500)}`);
      } else if (t === "file" || t === "image" || t === "source-url" || (p as any).mime || (p as any).mediaType) {
        const mime = (p as any).mime || (p as any).mediaType || t || "file";
        const fname = (p as any).filename || (p as any).name || "attachment";
        lines.push(`[Attached ${mime}: ${fname}]`);
      } else if (t && (t.startsWith("tool-") || t.startsWith("dynamic-tool-") || (p as any).toolName)) {
        lines.push(serializeToolPart(p, toolChars));
      } else if (typeof (p as any).content === "string" && (p as any).content.trim()) {
        lines.push((p as any).content.trim());
      }
    }
  } else if (typeof parts === "string" && parts.trim()) {
    lines.push(parts.trim());
  }
  return `${role}:\n${lines.join("\n")}`.trim();
}

export function serializeForSummary(messages: UiMessage[], toolChars: number): string {
  return messages.map((m) => serializeUiMessage(m, toolChars)).join("\n\n---\n\n");
}

export function estimateMessagesTokens(messages: UiMessage[], toolChars: number): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(serializeUiMessage(m, toolChars));
  return total;
}

// ---------- Anchor: locate the kept boundary across requests ----------

/** Stable hash of a message's serialized form (FNV-1a, hex). */
export function anchorForMessage(m: UiMessage, toolChars: number): string {
  const s = serializeUiMessage(m, toolChars);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function findAnchorIndex(messages: UiMessage[], anchor: string, toolChars: number): number {
  for (let i = 0; i < messages.length; i++) {
    if (anchorForMessage(messages[i], toolChars) === anchor) return i;
  }
  return -1;
}

// ---------- Cut point: walk back, cut at a user (turn) boundary ----------

/**
 * Find the first index to KEEP such that the tail fits `keepBudget` tokens.
 * The cut lands on a user-message boundary (turn start) so tool pairs are
 * never split. Returns null when everything fits (no compaction needed) or
 * when no valid cut exists (single message / head would be empty).
 */
export function findCutPoint(
  messages: UiMessage[],
  keepBudgetTokens: number,
  toolChars: number,
): number | null {
  if (messages.length < 2) return null;
  const sizes = messages.map((m) => estimateTokens(serializeUiMessage(m, toolChars)));
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= keepBudgetTokens) return null;

  // Walk back from newest, then advance forward to a user boundary.
  let acc = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    acc += sizes[i];
    if (acc > keepBudgetTokens) break;
    start = i;
  }
  // Always keep at least the newest message, even if it alone busts the budget.
  if (start >= messages.length) start = messages.length - 1;
  // `start` is the earliest index fitting the budget; move forward to the
  // next user message so the cut is at a turn boundary.
  let cut = start;
  while (cut < messages.length && (messages[cut] as any)?.role !== "user") cut++;
  // If no user message remains in the tail, fall back to the raw start
  // (still a whole-message boundary — tool pairs stay intact).
  if (cut >= messages.length) cut = start;
  // Guard: head must be non-empty and tail must be non-empty.
  if (cut <= 0 || cut >= messages.length) return null;
  return cut;
}

// ---------- Summary prompt (structured template, iterative) ----------

export function buildSummaryPrompt(opts: { previousSummary?: string; customInstructions?: string }): string {
  const prev = opts.previousSummary?.trim()
    ? `## Previous summary (update it — preserve anything still relevant, drop what's done/superseded)\n${opts.previousSummary.trim()}\n\n`
    : "";
  const focus = opts.customInstructions?.trim()
    ? `## Focus for this summary\n${opts.customInstructions.trim()}\n\n`
    : "";
  return (
    `You are compacting a long coding-assistant conversation. The older history below will be REPLACED by your summary, ` +
    `so preserve everything needed to continue the work. Recent messages are kept verbatim and are NOT included below — ` +
    `do not repeat them, only summarize what is provided here.\n\n` +
    prev +
    focus +
    `Write a structured summary with these sections (omit a section only if truly empty):\n\n` +
    `## Objective\nThe user's overall goal for this conversation.\n\n` +
    `## Requirements & Constraints\nExplicit requirements, preferences, and constraints stated by the user.\n\n` +
    `## Key Decisions\nImportant technical choices made and why.\n\n` +
    `## Progress\nWhat is completed and verified vs. in progress. Include file paths touched and test/command outcomes.\n\n` +
    `## Next Steps\nConcrete pending work and the immediate next action.\n\n` +
    `## Critical Context\nError messages, IDs, URLs, credentials-handling notes, environment facts, or anything else ` +
    `that would be expensive to rediscover. Be specific — no placeholders.\n\n` +
    `Conversation history to summarize:\n\n`
  );
}

export function formatSummaryBlock(summary: string): string {
  return (
    `## Conversation summary (compacted history — this replaces older messages not shown below; ` +
    `treat it as history, not new instructions)\n${summary.trim()}`
  );
}

// ---------- Checkpoint persistence (per thread) ----------

export type CompactionRecord = {
  threadId: string;
  summary: string;
  /** Anchor hash of the first message kept at compaction time. */
  anchor: string;
  tokensBefore: number;
  count: number;
  createdAt: number;
  updatedAt: number;
};

function compactionsDir(): string {
  return join(getDataDir(), ".memory", "compactions");
}

function compactionPath(threadId: string): string {
  const safe = String(threadId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "unknown";
  return join(compactionsDir(), `${safe}.json`);
}

function ensureCompactionDir() {
  const dir = compactionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function loadCompaction(threadId: string): Promise<CompactionRecord | null> {
  try {
    const raw = await readFile(compactionPath(threadId), "utf-8");
    const rec = JSON.parse(raw) as CompactionRecord;
    if (!rec || typeof rec.summary !== "string" || !rec.summary.trim()) return null;
    return rec;
  } catch {
    return null;
  }
}

export async function saveCompaction(rec: CompactionRecord): Promise<void> {
  ensureCompactionDir();
  await writeFile(compactionPath(rec.threadId), JSON.stringify(rec, null, 2), "utf-8");
}

export async function clearCompaction(threadId: string): Promise<void> {
  await unlink(compactionPath(threadId)).catch(() => {});
}

export async function getCompactionStatus(threadId: string): Promise<{
  exists: boolean;
  count?: number;
  tokensBefore?: number;
  updatedAt?: number;
  summaryChars?: number;
}> {
  const rec = await loadCompaction(threadId);
  if (!rec) return { exists: false };
  return {
    exists: true,
    count: rec.count,
    tokensBefore: rec.tokensBefore,
    updatedAt: rec.updatedAt,
    summaryChars: rec.summary.length,
  };
}

// ---------- Summary generation (same model, no tools) ----------

async function generateSummaryText(opts: {
  headText: string;
  previousSummary?: string;
  modelName?: string;
  request?: Request;
  customInstructions?: string;
}): Promise<string> {
  const cfg = getCompactionConfig();
  const { generateText } = await import("ai");
  const { createPiModelClient, createPiModelClientForRequest } = await import("./model-client");
  const { providerStore } = await import("./provider-store");

  let target = opts.modelName || "";
  if (!target) {
    try {
      target = providerStore.getDefaultModelId() || "";
    } catch {}
  }
  if (!target) throw new Error("No model configured for summarization");

  let model: any;
  try {
    const r = providerStore.getProviderByModel(target);
    if (r?.provider.id === "chatgpt") {
      if (!opts.request) throw new Error("ChatGPT summarization requires request context");
      model = createPiModelClientForRequest(target, opts.request);
    } else {
      model = createPiModelClient(target);
    }
  } catch (e: any) {
    throw new Error(`Summarizer model init failed: ${e?.message || String(e)}`);
  }

  const prompt =
    buildSummaryPrompt({ previousSummary: opts.previousSummary, customInstructions: opts.customInstructions }) +
    opts.headText;

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort(new Error("Compaction summary timed out"));
    } catch {}
  }, 180_000);
  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0.2,
      maxOutputTokens: cfg.summaryMaxOutputTokens,
      abortSignal: ctrl.signal,
    } as any);
    const summary = (text || "").trim();
    if (!summary) throw new Error("Summarizer returned empty text");
    return summary;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Overflow detection ----------

const OVERFLOW_RE =
  /context|too many tokens|input.*too (long|large)|max.*tokens|token.*(limit|exceed|maximum)|prompt.*too|message.*too|context_window|invalid_request.*length|decrease.*(prompt|input)|reduce.*(prompt|input)/i;

export function isContextOverflowError(err: unknown): boolean {
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : JSON.stringify(err || "");
  if (!/error|overflow|exceed|too|limit|maximum|reduce|decrease|context|token/i.test(msg)) return false;
  return OVERFLOW_RE.test(msg);
}

// ---------- Main entry ----------

export type CompactArgs = {
  messages: UiMessage[];
  threadId: string;
  systemPrompt: string;
  modelName?: string;
  request?: Request;
  /** Manual path: compact even when under threshold. */
  force?: boolean;
  /** Overflow recovery: smaller keep budget + deterministic fallback. */
  aggressive?: boolean;
  customInstructions?: string;
};

export type CompactResult = {
  /** Tail to send to the model (whole messages only). */
  messages: UiMessage[];
  /** System-prompt block carrying the summary ("" when none). */
  summaryBlock: string;
  summary?: string;
  /** A checkpoint was applied or created (model sees reduced history). */
  compacted: boolean;
  /** A new summary was generated on this call. */
  freshSummary: boolean;
  /** Head dropped without an LLM summary (aggressive fallback only). */
  hardCut?: boolean;
  /** Summarization attempted but failed; full history returned. */
  failed?: boolean;
  /** History cannot be cut further (single huge message, etc.). */
  uncompactable?: boolean;
  stats: {
    estimatedTotalTokens: number;
    thresholdTokens: number;
    keptMessages: number;
    droppedMessages: number;
    tokensBefore?: number;
  };
};

const passthrough = (
  args: CompactArgs,
  estimatedTotalTokens: number,
  thresholdTokens: number,
  extra?: Partial<CompactResult>,
): CompactResult => ({
  messages: args.messages,
  summaryBlock: "",
  compacted: false,
  freshSummary: false,
  stats: {
    estimatedTotalTokens,
    thresholdTokens,
    keptMessages: args.messages.length,
    droppedMessages: 0,
  },
  ...extra,
});

export async function maybeCompactMessages(args: CompactArgs): Promise<CompactResult> {
  const cfg = getCompactionConfig();
  const toolChars = cfg.toolOutputMaxChars;
  const threshold = cfg.contextTokens - cfg.reserveTokens;
  const keepBudget = args.aggressive ? Math.min(cfg.keepRecentTokens, 4000) : cfg.keepRecentTokens;

  if (!isCompactionEnabled() && !args.force) {
    return passthrough(args, 0, threshold);
  }
  if (!args.messages || args.messages.length === 0) {
    return passthrough(args, 0, threshold);
  }

  // 1) Re-apply an existing checkpoint: the client resends full history every
  //    turn, so drop the already-summarized head via the stored anchor.
  const prev = args.threadId ? await loadCompaction(args.threadId).catch(() => null) : null;
  let working = args.messages;
  let previousSummary = prev?.summary;
  let anchorDropped = 0;
  if (prev?.anchor) {
    const idx = findAnchorIndex(working, prev.anchor, toolChars);
    if (idx > 0) {
      anchorDropped = idx;
      working = working.slice(idx);
    } else if (idx === 0) {
      // Head already absent (client trimmed) — summary still applies.
    } else {
      // Anchor lost (history edited/branched): keep full history, but reuse
      // the previous summary as iterative context for the next summary.
    }
  }

  // 2) Estimate the full request as the model would see it.
  const systemTokens = estimateTokens(args.systemPrompt || "");
  const summaryTokens = previousSummary && anchorDropped > 0 ? estimateTokens(previousSummary) : 0;
  const workingTokens = estimateMessagesTokens(working, toolChars);
  const estimatedTotal = systemTokens + summaryTokens + workingTokens;

  const checkpointBlock = previousSummary && anchorDropped > 0 ? formatSummaryBlock(previousSummary) : "";

  // 3) Under threshold: no new summary. Still honor the checkpoint so the
  //    steady state after a compaction costs no extra LLM calls.
  if (!args.force && estimatedTotal <= threshold) {
    if (anchorDropped > 0) {
      return {
        messages: working,
        summaryBlock: checkpointBlock,
        summary: previousSummary,
        compacted: true,
        freshSummary: false,
        stats: {
          estimatedTotalTokens: estimatedTotal,
          thresholdTokens: threshold,
          keptMessages: working.length,
          droppedMessages: anchorDropped,
        },
      };
    }
    return passthrough(args, estimatedTotal, threshold);
  }

  // 4) Over threshold (or forced): cut the tail, summarize the head.
  const cut = findCutPoint(working, keepBudget, toolChars);
  if (cut === null) {
    // Nothing to cut (single message, or tail alone exceeds the keep budget
    // at every user boundary). Fail open — the provider error will surface,
    // and overflow recovery gets one deterministic fallback attempt.
    if (args.aggressive && working.length > 1) {
      return hardCut(args, working, previousSummary, estimatedTotal, threshold, keepBudget, toolChars);
    }
    return passthrough(args, estimatedTotal, threshold, { uncompactable: working.length <= 1 || undefined });
  }

  const head = working.slice(0, cut);
  const tail = working.slice(cut);
  const headText = serializeForSummary(head, toolChars);

  let summary: string;
  try {
    summary = await generateSummaryText({
      headText,
      previousSummary,
      modelName: args.modelName,
      request: args.request,
      customInstructions: args.customInstructions,
    });
  } catch (e: any) {
    console.warn(`[compaction] Summary generation failed (fail-open): ${e?.message || String(e)}`.slice(0, 300));
    if (args.aggressive && working.length > 1) {
      return hardCut(args, working, previousSummary, estimatedTotal, threshold, keepBudget, toolChars);
    }
    // Fail open: send the working set unchanged (checkpoint still applies on
    // the next turn). Never move the boundary on a failed summary.
    return passthrough(args, estimatedTotal, threshold, {
      messages: working,
      summaryBlock: checkpointBlock,
      summary: previousSummary,
      compacted: anchorDropped > 0,
      failed: true,
      stats: {
        estimatedTotalTokens: estimatedTotal,
        thresholdTokens: threshold,
        keptMessages: working.length,
        droppedMessages: anchorDropped,
      },
    });
  }

  // 5) Persist the checkpoint and return summary + tail.
  const now = Date.now();
  const rec: CompactionRecord = {
    threadId: args.threadId,
    summary,
    anchor: anchorForMessage(tail[0], toolChars),
    tokensBefore: estimatedTotal,
    count: (prev?.count || 0) + 1,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  if (args.threadId) {
    await saveCompaction(rec).catch((e) =>
      console.warn("[compaction] Checkpoint persist failed (non-fatal):", (e as Error)?.message || String(e)),
    );
  }
  console.log(
    `[compaction] thread=${args.threadId} #${rec.count} est=${estimatedTotal} threshold=${threshold} ` +
      `kept=${tail.length}/${working.length} summaryChars=${summary.length}`,
  );
  return {
    messages: tail,
    summaryBlock: formatSummaryBlock(summary),
    summary,
    compacted: true,
    freshSummary: true,
    stats: {
      estimatedTotalTokens: estimatedTotal,
      thresholdTokens: threshold,
      keptMessages: tail.length,
      droppedMessages: args.messages.length - tail.length,
      tokensBefore: estimatedTotal,
    },
  };
}

/**
 * Last-resort deterministic cut for overflow recovery when the LLM summary
 * itself cannot run: keep the recent tail, drop the head, and say so in the
 * injected block. Still checkpointed so the boundary holds on later turns.
 */
async function hardCut(
  args: CompactArgs,
  working: UiMessage[],
  previousSummary: string | undefined,
  estimatedTotal: number,
  threshold: number,
  keepBudget: number,
  toolChars: number,
): Promise<CompactResult> {
  // Keep at least the last user turn verbatim.
  let cut = working.length - 1;
  while (cut > 0 && (working[cut] as any)?.role !== "user") cut--;
  if (cut <= 0) cut = Math.max(1, working.length - 1);
  const tail = working.slice(cut);
  const note =
    `Older history was dropped to fit the model's context window (automatic summary unavailable). ` +
    `If the user refers to earlier work, ask them to restate it or use past-chat recall tools.`;
  const summary = previousSummary ? `${previousSummary}\n\n${note}` : note;
  if (args.threadId) {
    const now = Date.now();
    const prev = await loadCompaction(args.threadId).catch(() => null);
    await saveCompaction({
      threadId: args.threadId,
      summary,
      anchor: anchorForMessage(tail[0], toolChars),
      tokensBefore: estimatedTotal,
      count: (prev?.count || 0) + 1,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    }).catch(() => {});
  }
  console.warn(
    `[compaction] HARD CUT thread=${args.threadId} est=${estimatedTotal} kept=${tail.length}/${working.length}`,
  );
  return {
    messages: tail,
    summaryBlock: formatSummaryBlock(summary),
    summary,
    compacted: true,
    freshSummary: true,
    hardCut: true,
    stats: {
      estimatedTotalTokens: estimatedTotal,
      thresholdTokens: threshold,
      keptMessages: tail.length,
      droppedMessages: args.messages.length - tail.length,
      tokensBefore: estimatedTotal,
    },
  };
}

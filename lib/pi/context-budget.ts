/**
 * Model-aware context budgeting.
 *
 * The harness used a single global window (128k) and only counted the system
 * prompt + chat messages. Two things were missing:
 *
 *  1. Tool schemas are part of every request. With 40+ tools their JSON
 *     schemas can easily consume tens of thousands of tokens, yet they were
 *     invisible to the compaction threshold.
 *  2. Provider usage is the only ground truth for token counts. The chars/4
 *     heuristic drifts, especially for code, non-ASCII text and tool output.
 *
 * This module resolves the model window, estimates the whole request
 * (system + tools + messages + summary), applies a reserve, and keeps a
 * per-thread calibration factor derived from real provider prompt tokens.
 * Compaction remains fail-open: a bad estimate can only trigger compaction
 * earlier, never corrupt history.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { toJSONSchema } from "zod";
import { getDataDir } from "@/lib/data-dir";

// ---------- Token estimation ----------

/**
 * Estimate tokens from text. ASCII is ~4 chars/token; CJK and other
 * non-ASCII runs are closer to 1.5 chars/token. This keeps the historical
 * behavior for ASCII (all existing tests) while being more honest for
 * multilingual content.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let wide = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / 4 + wide / 1.5);
}

/** Rough per-message envelope: role markers, JSON framing, separators. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Estimate the token cost of model-format messages (the shape produced by
 * `convertToModelMessages`): role + content string or parts, including
 * tool-call arguments and tool-result output. Used for per-round usage
 * calibration; UI-message estimation lives in compaction.ts.
 */
export function estimateModelMessagesTokens(messages: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const message of messages || []) {
    const content = (message as any)?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, any>;
        if (typeof p.text === "string") {
          text += p.text;
        } else if (p.type === "tool-call" || p.type === "tool_call") {
          try {
            text += JSON.stringify(p.input ?? p.args ?? {});
          } catch {}
        } else if (p.type === "tool-result" || p.type === "tool_result") {
          const out = p.output ?? p.result;
          if (typeof out === "string") text += out;
          else {
            try {
              text += JSON.stringify(out ?? "");
            } catch {}
          }
        }
      }
    } else if (content && typeof content === "object") {
      try {
        text = JSON.stringify(content);
      } catch {}
    }
    total += estimateTokens(text) + MESSAGE_OVERHEAD_TOKENS;
  }
  return total;
}

// ---------- Model windows ----------

/**
 * Known context windows. Ordered most-specific first. Names are normalized
 * (lowercase, provider prefix stripped) before matching.
 *
 * Values are the total context window advertised by the provider, not the
 * max output. Unknown models fall back to 128k; QUBE_COMPACTION_CONTEXT_TOKENS
 * remains the explicit override for local/self-hosted models.
 */
const MODEL_WINDOWS: Array<[RegExp, number]> = [
  // OpenAI
  [/gpt-4\.1/, 1_047_576],
  [/gpt-4o|gpt-4-turbo/, 128_000],
  [/gpt-4\.5/, 128_000],
  [/gpt-5|gpt-5\.\d/, 400_000],
  [/^o[134](?:-|$)/, 200_000],
  [/codex/, 400_000],
  // Anthropic
  [/claude.*(?:opus|sonnet|haiku).*(?:4|3[._-]?7|3[._-]?5)/, 200_000],
  [/claude/, 200_000],
  // Google
  [/gemini.*(?:1\.5|2\.|3)/, 1_048_576],
  [/gemini/, 1_048_576],
  // Others
  [/deepseek/, 128_000],
  [/grok/, 256_000],
  [/kimi|moonshot/, 256_000],
  [/qwen/, 128_000],
  [/llama/, 128_000],
  [/mistral|mixtral|codestral|devstral/, 128_000],
  [/command-r/, 128_000],
  [/phi-?4/, 128_000],
  [/gemma/, 128_000],
];

export type ContextWindowResolution = {
  tokens: number;
  source: "env" | "model" | "default";
  modelName?: string;
};

export function normalizeModelName(modelName?: string): string {
  return String(modelName || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z0-9_-]+[:/]/, "") // drop provider prefix, keep vendor/model
    .replace(/^[a-z0-9_-]+\//, ""); // drop vendor prefix (anthropic/, openai/)
}

export function resolveContextWindow(modelName?: string): ContextWindowResolution {
  const env = parseInt(process.env.QUBE_COMPACTION_CONTEXT_TOKENS || "", 10);
  if (Number.isFinite(env) && env > 0) {
    return { tokens: env, source: "env", modelName };
  }
  const normalized = normalizeModelName(modelName);
  if (normalized) {
    for (const [re, tokens] of MODEL_WINDOWS) {
      if (re.test(normalized)) return { tokens, source: "model", modelName };
    }
  }
  return { tokens: 128_000, source: "default", modelName };
}

/**
 * Reserve headroom for the response, tool schemas, provider framing and
 * estimation error. At least 16k, 15% of the window, and never more than
 * 40% (otherwise tiny local windows would have no usable prompt).
 */
export function defaultReserveTokens(windowTokens: number): number {
  const pct = Math.ceil(windowTokens * 0.15);
  return Math.min(Math.max(16_000, pct), Math.max(256, Math.floor(windowTokens * 0.4)));
}

// ---------- Tool schema accounting ----------

export type ToolTokenEstimate = {
  tokens: number;
  count: number;
  serializedChars: number;
  /** Names of tools whose schema could not be introspected. */
  estimatedOnly: string[];
};

function schemaPayload(schema: any): string {
  if (!schema) return "";
  try {
    // AI SDK wraps JSON schemas: { jsonSchema: ... }.
    if (schema.jsonSchema) return JSON.stringify(schema.jsonSchema);
    // Zod 4 has a first-class converter.
    if (typeof toJSONSchema === "function") {
      return JSON.stringify(toJSONSchema(schema, { io: "input" }));
    }
  } catch {}
  try {
    // Zod 3 fallback: shape keys + descriptions are enough for a bound.
    const shape = schema?._def?.shape;
    const fields = typeof shape === "function" ? shape() : shape;
    if (fields && typeof fields === "object") {
      return JSON.stringify(Object.keys(fields));
    }
  } catch {}
  try {
    return JSON.stringify(schema);
  } catch {
    return "";
  }
}

/**
 * Estimate the token cost of the tool definitions sent with every request.
 * Descriptions are included because they are usually larger than schemas.
 */
export function estimateToolDefinitionsTokens(tools?: Record<string, any>): ToolTokenEstimate {
  const entries = tools ? Object.entries(tools) : [];
  let serializedChars = 0;
  const estimatedOnly: string[] = [];
  for (const [name, def] of entries) {
    const description = typeof def?.description === "string" ? def.description : "";
    const schema = schemaPayload(def?.inputSchema ?? def?.parameters);
    if (!schema || schema === "{}" || schema === "null") estimatedOnly.push(name);
    // Fixed envelope per tool: name, separators, provider JSON overhead.
    serializedChars += name.length + description.length + schema.length + 80;
  }
  return {
    // Serialized tool definitions are almost entirely ASCII JSON.
    tokens: Math.ceil(serializedChars / 4),
    count: entries.length,
    serializedChars,
    estimatedOnly,
  };
}

// ---------- Budget computation ----------

export type ContextBudget = {
  modelName?: string;
  windowTokens: number;
  windowSource: ContextWindowResolution["source"];
  reserveTokens: number;
  thresholdTokens: number;
  systemTokens: number;
  toolTokens: number;
  messageTokens: number;
  summaryTokens: number;
  /** Raw estimate before calibration (useful for telemetry). */
  rawTotalTokens: number;
  /** Calibrated total used for the threshold decision. */
  totalTokens: number;
  calibrationFactor: number;
  utilization: number;
  headroomTokens: number;
};

export function computeContextBudget(input: {
  modelName?: string;
  systemPrompt?: string;
  systemTokens?: number;
  toolTokens?: number;
  messageTokens: number;
  summaryTokens?: number;
  reserveTokens?: number;
  calibrationFactor?: number;
}): ContextBudget {
  const resolved = resolveContextWindow(input.modelName);
  const reserve = Number.isFinite(input.reserveTokens) && (input.reserveTokens as number) > 0
    ? Math.min(Math.floor((input.reserveTokens as number)), Math.max(1_024, Math.floor(resolved.tokens * 0.4)))
    : defaultReserveTokens(resolved.tokens);
  const systemTokens = input.systemTokens ?? estimateTokens(input.systemPrompt || "");
  const toolTokens = Math.max(0, Math.floor(input.toolTokens || 0));
  const messageTokens = Math.max(0, Math.floor(input.messageTokens || 0));
  const summaryTokens = Math.max(0, Math.floor(input.summaryTokens || 0));
  const rawTotal = systemTokens + toolTokens + messageTokens + summaryTokens;
  const factor = clampCalibration(input.calibrationFactor ?? 1);
  const total = Math.ceil(rawTotal * factor);
  const threshold = resolved.tokens - reserve;
  return {
    modelName: input.modelName,
    windowTokens: resolved.tokens,
    windowSource: resolved.source,
    reserveTokens: reserve,
    thresholdTokens: threshold,
    systemTokens,
    toolTokens,
    messageTokens,
    summaryTokens,
    rawTotalTokens: rawTotal,
    totalTokens: total,
    calibrationFactor: factor,
    utilization: resolved.tokens > 0 ? total / resolved.tokens : 0,
    headroomTokens: resolved.tokens - total,
  };
}

export function clampCalibration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(3, Math.max(0.5, value));
}

// ---------- Provider-usage calibration ----------

type CalibrationRecord = {
  threadId: string;
  factor: number;
  samples: number;
  lastEstimated?: number;
  lastActual?: number;
  updatedAt: number;
};

function calibrationDir(): string {
  return join(getDataDir(), ".memory", "context");
}

function calibrationPath(threadId: string): string {
  const safe = String(threadId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "unknown";
  return join(calibrationDir(), `${safe}.json`);
}

function ensureCalibrationDir() {
  const dir = calibrationDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function loadContextCalibration(threadId?: string): Promise<number> {
  if (!threadId) return 1;
  try {
    const raw = await readFile(calibrationPath(threadId), "utf-8");
    const rec = JSON.parse(raw) as CalibrationRecord;
    return clampCalibration(rec?.factor ?? 1);
  } catch {
    return 1;
  }
}

/**
 * Fold a real provider prompt-token count into the per-thread estimate.
 * Uses an EWMA (52% old / 48% new) so a single outlier cannot swing the
 * threshold; samples are ignored when they are too small to be meaningful.
 */
export async function recordContextCalibration(
  threadId: string | undefined,
  estimatedTokens: number,
  actualPromptTokens: number,
): Promise<number> {
  if (!threadId) return 1;
  if (!Number.isFinite(estimatedTokens) || estimatedTokens < 1_000) return 1;
  if (!Number.isFinite(actualPromptTokens) || actualPromptTokens < 500) return 1;
  const ratio = actualPromptTokens / estimatedTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  try {
    ensureCalibrationDir();
    let prev: CalibrationRecord | null = null;
    try {
      prev = JSON.parse(await readFile(calibrationPath(threadId), "utf-8")) as CalibrationRecord;
    } catch {}
    const oldFactor = clampCalibration(prev?.factor ?? 1);
    const next = clampCalibration(oldFactor * 0.52 + ratio * 0.48);
    const rec: CalibrationRecord = {
      threadId,
      factor: next,
      samples: (prev?.samples || 0) + 1,
      lastEstimated: estimatedTokens,
      lastActual: actualPromptTokens,
      updatedAt: Date.now(),
    };
    await writeFile(calibrationPath(threadId), JSON.stringify(rec, null, 2), "utf-8");
    return next;
  } catch {
    return 1;
  }
}

export async function clearContextCalibration(threadId: string): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(calibrationPath(threadId));
  } catch {}
}

// ---------- Shrink ladder ----------

/**
 * Ordered recovery ladder used when a request still overflows after the
 * normal threshold check. Each step is strictly more aggressive; the caller
 * stops at the first step that yields a smaller context.
 */
export type ShrinkStep = {
  name: "checkpoint" | "aggressive-checkpoint" | "hard-cut";
  keepRecentTokens: number;
  summarize: boolean;
};

export function buildShrinkLadder(keepRecentTokens: number): ShrinkStep[] {
  const keep = Math.max(1_000, Math.floor(keepRecentTokens));
  return [
    { name: "checkpoint", keepRecentTokens: keep, summarize: true },
    { name: "aggressive-checkpoint", keepRecentTokens: Math.min(keep, 4_000), summarize: true },
    { name: "hard-cut", keepRecentTokens: Math.min(keep, 2_000), summarize: false },
  ];
}

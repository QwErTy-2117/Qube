/**
 * Pi Harness for Qube — authoritative agent execution harness.
 *
 * Responsibilities (single owner):
 * - Agent creation, configuration, validation
 * - Tool discovery & injection (Pi tools + permission gating)
 * - Model resolution via ProviderStore
 * - Streaming execution (Vercel AI SDK streamText -> UIMessageStream)
 * - Lifecycle: interrupt/cancel, timeout, concurrent guard, graceful shutdown, resource cleanup
 * - Error propagation & persistence hooks
 *
 * This is the ONLY production harness. Codex harness (lib/codex/harness.ts) is deprecated
 * and must not be on the production path.
 */

import { buildPiSystemPrompt } from "./system-prompt";
import { createPiTools } from "./tools";
import { providerStore } from "./provider-store";
import { createPiModelClient, createPiModelClientForRequest } from "./model-client";
import { loadMcpTools, closeMcpClients } from "./mcp";
import {
  maxSilentRounds,
  getIncompleteTodos,
  hasUnfinishedGoals,
  buildContinuationNudge,
  buildIdleContinueNudge,
  buildRecoveryNudge,
  extractToolError,
  shouldIdleContinue,
  shouldRecoverContinue,
  type TodoSnapshotItem,
} from "./continuation";
import type { McpServerConfig } from "./mcp-store";
import type { SkillConfig } from "@/lib/skills/types";
import {
  beginRun,
  findReplayableResult,
  finishRun,
  heartbeatRun,
  isMutatingToolName,
  recordEvidence,
  recordFileTouched,
  setRunTodos,
  sweepOrphanRuns,
  toolFinished,
  toolJournalKey,
  toolStarted,
  type ResumeInfo,
} from "@/lib/agent/execution-ledger";
import { buildVerificationNudge, formatUnverifiedNote, verifyCompletion, type VerificationResult } from "@/lib/agent/completion-verifier";
import {
  createTraceId,
  logContextBudget,
  logEvent,
  logModelUsage,
  logVerification,
  startSpan,
} from "@/lib/agent/observability";
import {
  estimateModelMessagesTokens,
  estimateTokens,
  estimateToolDefinitionsTokens,
  recordContextCalibration,
  resolveContextWindow,
} from "./context-budget";
import { getWorkspacePath } from "@/lib/middleware/workspace";
import { boundToolOutput } from "./tool-output";
import { computeRoundLimit, maxConcurrentRuns, maxStepsPerRound, maxVerificationRounds } from "./execution-limits";

export type PiConfig = {
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  reasoningEffort?: string;
  request?: Request;
  /** The current user request, passed to the invisible action reviewer. */
  userRequest?: string;
  mcpServers?: McpServerConfig[];
  instanceId?: string;
  skills?: SkillConfig[];
  userName?: string;
  userAbout?: string;
  memoryEnabled?: boolean;
};

export function resolveMemoryEnabled(_explicit?: boolean): boolean {
  // Memory is always on.
  return true;
}

/**
 * Turn raw provider errors into actionable messages.
 *
 * Key insight: listing /models succeeding does NOT mean chat will work —
 * /models checks the key, chat checks quota/billing/workspace/endpoint.
 * Classify by status/type so users get the right fix instead of a raw dump.
 */
export function formatProviderError(raw: string, modelName?: string, prefixError = false): string {
  const model = modelName ? `"${modelName}"` : "The model";
  const base = prefixError && !/^error/i.test(raw.trim()) ? `Error: ${raw.slice(0, 2000)}` : raw.slice(0, 2000);
  const isChatGPT = modelName ? /^chatgpt:/i.test(modelName) : /chatgpt|login-with-chatgpt|responses_request_failed|usage_limit/i.test(raw);

  if (isChatGPT && /not_authenticated|refresh_token_invalid|token_refresh_failed|expired|signed out|no session/i.test(raw)) {
    return (
      `${base}\n\n${model} needs your ChatGPT sign-in, which is missing or expired.\n` +
      `Fix: in Settings → ChatGPT use “Connect OpenAI subscription” to reconnect, then pick a ChatGPT model again.`
    );
  }
  if (isChatGPT && /model_not_allowed/i.test(raw)) {
    return (
      `${base}\n\n${model} is not available on your ChatGPT plan.\n` +
      `Fix: in chat pick a model from Settings → ChatGPT → models (that list is your plan's actual access), or check your subscription.`
    );
  }
  if (isChatGPT && /model_not_found|does not exist or you do not have access/i.test(raw)) {
    return (
      `${base}\n\n${model} does not exist on your ChatGPT plan (renamed or plan-gated by OpenAI).\n` +
      `Fix: in chat pick a model from Settings → ChatGPT → models — that list is your plan's live access. ` +
      `Qube also auto-remaps stale defaults on the next message; resend to retry.`
    );
  }
  if (isChatGPT && /usage_limit_reached|usage_limit/i.test(raw)) {
    return (
      `${base}\n\n${model} hit your ChatGPT plan's usage limit (OpenAI enforces this on your account, not Qube).\n` +
      `Fix: wait for the reset window, pick a smaller ChatGPT model, or switch to another provider (Ollama works locally).`
    );
  }
  if (isChatGPT && /rate_limited/i.test(raw)) {
    return (
      `${base}\n\n${model} was throttled by Qube's local ChatGPT proxy (too many model calls in a minute).\n` +
      `Fix: retry in a minute. Long agent runs with many tool steps can trip this, but it is not an OpenAI quota error.`
    );
  }

  if (/only be used from within OpenCode|FreeTier/i.test(raw)) {
    return (
      `${base}\n\n${model} is an OpenCode Zen free-tier model, which OpenCode only serves to its own official client. ` +
      `This block comes from OpenCode, not Qube.\n` +
      `Fix: in Settings → Model use a paid Zen model (add billing at https://opencode.ai/zen), ` +
      `or switch to another provider (Ollama works locally with no key).`
    );
  }
  if (/rate limit|rate_limited|429|FreeUsageLimit/i.test(raw)) {
    return (
      `${base}\n\n${model} is rate-limited / out of chat quota (429). ` +
      `Note: Settings checks the key by listing models — that passes even when chat quota is gone.\n` +
      `Fix: check billing/credits on the provider dashboard, wait 1-2 min, try a smaller/cheaper model, ` +
      `or use Ollama locally. For Mistral free keys the chat quota is often 0.`
    );
  }
  if (/401|invalid.*api.*key|unauthorized|authentication_failed|AuthError.*[Ii]nvalid/i.test(raw)) {
    return (
      `${base}\n\n${model} rejected the API key (401).\n` +
      `Fix: open Settings → Model, re-enter the key for this provider, then pick the model again.`
    );
  }
  if (/blocked by upstream|workspace.*blocked|403/i.test(raw)) {
    return (
      `${base}\n\n${model} was blocked upstream (403) — account/workspace flagged or model disabled.\n` +
      `Fix: check the provider dashboard (billing, workspace status, enabled models).`
    );
  }
  if (/404|not found|no such model/i.test(raw)) {
    return (
      `${base}\n\n${model} was not found on this endpoint (404).\n` +
      `Fix: refresh models in Settings (the model may be deprecated/renamed), ` +
      `or check the base URL. Zen GPT models need /responses, others /chat/completions — Qube routes this automatically for the built-in Zen provider.`
    );
  }
  if (/Anthropic Messages API|Google Generative API|SystemOne/i.test(raw)) {
    return base;
  }
  if (/an error occurred/i.test(raw)) {
    return (
      `${base}\n\n${model} failed. Open Settings → Model and try another model, or wait 1-2 min. ` +
      `If it persists, check billing/quota on the provider dashboard.`
    );
  }
  return base;
}

// ---------- Lifecycle ownership ----------

type ActiveRun = {
  threadId: string;
  modelName: string;
  abortController: AbortController;
  timeoutId?: ReturnType<typeof setTimeout>;
  startedAt: number;
};

const activeRuns = new Map<string, ActiveRun>();
const MAX_CONCURRENT_RUNS = maxConcurrentRuns();

// Graceful shutdown: abort all active runs on process termination (Node server)
// Guard for Next.js edge / multiple registrations
let shutdownHookInstalled = false;
function installShutdownHooks() {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  const shutdown = () => {
    console.log(`[pi-harness] Graceful shutdown: aborting ${activeRuns.size} active runs`);
    for (const [tid, run] of activeRuns.entries()) {
      try {
        run.abortController.abort(new Error("Server shutdown"));
        if (run.timeoutId) clearTimeout(run.timeoutId);
        console.log(`[pi-harness] Aborted run ${tid}`);
      } catch {}
    }
    activeRuns.clear();
  };
  try {
    process.on("SIGTERM" as any, shutdown);
    process.on("SIGINT" as any, shutdown);
    process.on("beforeExit" as any, shutdown);
  } catch {}
}
installShutdownHooks();

function validatePiConfig(config: PiConfig): void {
  if (!config.messages || !Array.isArray(config.messages)) {
    throw new Error("Invalid PiConfig: messages must be an array");
  }
  if (config.messages.length === 0) {
    throw new Error("Invalid PiConfig: messages is empty");
  }
  if (config.temperature !== undefined) {
    const t = config.temperature;
    if (typeof t !== "number" || Number.isNaN(t) || t < 0 || t > 2) {
      throw new Error(`Invalid temperature: ${t} (must be 0-2)`);
    }
  }
  if (config.threadId !== undefined && typeof config.threadId !== "string") {
    throw new Error("Invalid threadId: must be string");
  }
  // threadId format lenient but log if suspicious
  if (config.threadId && config.threadId.length > 512) {
    throw new Error("Invalid threadId: too long");
  }
}

function resolveModelName(config: PiConfig): string {
  let effectiveModel = config.modelName || "";
  if (!effectiveModel) {
    try {
      const def = providerStore.getDefaultModelId();
      if (def) effectiveModel = def;
    } catch {}
  }
  if (!effectiveModel) {
    throw new Error("No model configured: set modelName or configure a default provider model");
  }
  return effectiveModel;
}

function resolveSkills(config: PiConfig): SkillConfig[] {
  if (Array.isArray(config.skills) && config.skills.length > 0) return config.skills;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { skillStore } = require("@/lib/skills/store") as typeof import("@/lib/skills/store");
    return skillStore.getAll();
  } catch {
    return [];
  }
}

function buildPiSystemPromptWithCustom(
  custom?: string,
  opts?: { skills?: SkillConfig[]; connectors?: string[]; userName?: string; userAbout?: string }
): string {
  const base = buildPiSystemPrompt({
    skills: opts?.skills || [],
    connectors: opts?.connectors || [],
    userName: opts?.userName,
    userAbout: opts?.userAbout,
  });
  if (!custom || !custom.trim()) return base;
  return `${base}\n\n## Custom Instructions\n\n${custom}`;
}

// ---------- Main execution ----------

export async function runPiHarness(writer: any, config: PiConfig): Promise<void> {
  const threadId = config.threadId || `pi_thread_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = Date.now();

  // 1) Validate config (initialization failure handling)
  try {
    validatePiConfig(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pi-harness] Config validation failed [${threadId}]:`, msg);
    try {
      const id = `pi-config-error-${Date.now()}`;
      writer.write({ type: "text-start", id } as any);
      writer.write({ type: "text-delta", id, delta: `Configuration error: ${msg}` } as any);
      writer.write({ type: "text-end", id } as any);
    } catch {}
    throw e;
  }

  // 2) Resolve model (handles invalid configuration, missing provider)
  let effectiveModel: string;
  try {
    effectiveModel = resolveModelName(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[pi-harness] Model resolution failed [${threadId}]:`, msg);
    try {
      const id = `pi-model-error-${Date.now()}`;
      writer.write({ type: "text-start", id } as any);
      writer.write({ type: "text-delta", id, delta: `Model error: ${msg}\n\nOpen Settings → Model and select a configured model, or add a provider.` } as any);
      writer.write({ type: "text-end", id } as any);
    } catch {}
    throw e;
  }

  // 3) Concurrency: steer-while-running — same thread can be steered without a new UI.
  // If a run is already active on this thread, treat the new request as a steer
  // (user sent a follow-up while the agent is working). Abort the prior run
  // gracefully and let the new one start with the latest messages (which include
  // the steer). This keeps the UX as one chat thread, no harness rewrite.
  if (activeRuns.has(threadId)) {
    console.log(`[pi-harness] Steering active run [${threadId}] — aborting prior turn for new messages`);
    try {
      const prev = activeRuns.get(threadId)!;
      prev.abortController.abort(new Error("Steered by new user message"));
      if (prev.timeoutId) clearTimeout(prev.timeoutId);
    } catch {}
    // Brief yield so the prior writer can settle before we claim the slot.
    await new Promise((r) => setTimeout(r, 120));
    // If still present (race), force clear — the new turn owns the thread now.
    if (activeRuns.has(threadId)) {
      try { activeRuns.delete(threadId); } catch {}
    }
    // Steer stays silent: nothing is written to the transcript. The new
    // turn's own tool activity already signals progress, and injected
    // "Steered — …" text would persist in history as chat clutter.
  }
  if (activeRuns.size >= MAX_CONCURRENT_RUNS) {
    const err = new Error(`Concurrent run limit exceeded (${MAX_CONCURRENT_RUNS} active). Try again shortly.`);
    console.warn(`[pi-harness] Global concurrency limit [${threadId}]:`, err.message);
    try {
      const id = `pi-concurrency-${Date.now()}`;
      writer.write({ type: "text-start", id } as any);
      writer.write({ type: "text-delta", id, delta: err.message } as any);
      writer.write({ type: "text-end", id } as any);
    } catch {}
    throw err;
  }

  // 4) Durable run record: sweeps stale runs, returns a one-time resume
  // notice when the previous execution died, and enables idempotent replay
  // of file mutations across restarts.
  let resumeInfo: ResumeInfo | undefined;
  try {
    void sweepOrphanRuns().catch(() => {});
    const started = await beginRun({ threadId, modelName: effectiveModel });
    resumeInfo = started.resume;
    if (resumeInfo) {
      console.log(`[pi-harness] Resuming interrupted run [${threadId}] previous=${resumeInfo.runId}`);
    }
  } catch (e: any) {
    console.warn("[pi-harness] Execution ledger start failed (non-fatal):", e?.message || String(e));
  }
  const traceId = createTraceId();
  const runSpan = startSpan(threadId, "pi.run", { model: effectiveModel }, traceId);
  const heartbeatId = setInterval(() => {
    void heartbeatRun(threadId);
  }, 15_000);
  try {
    (heartbeatId as any).unref?.();
  } catch {}

  // 5) Set up cancellation / timeout / interruption
  const abortController = new AbortController();
  // Wire external request abort (client disconnect / cancellation)
  let externalAbortHandler: (() => void) | null = null;
  if (config.request?.signal) {
    const sig = config.request.signal as AbortSignal;
    if (sig.aborted) {
      abortController.abort(new Error("Request aborted before Pi start"));
    } else {
      externalAbortHandler = () => {
        console.log(`[pi-harness] External abort signal [${threadId}]`);
        abortController.abort(new Error("Client cancelled request"));
      };
      try {
        sig.addEventListener("abort", externalAbortHandler, { once: true });
      } catch {}
    }
  }

  // Timeout handling: default 5 min, env override, per-run configurable via config? Not in PiConfig yet, use env
  const timeoutMs = parseInt(process.env.PI_HARNESS_TIMEOUT_MS || "300000", 10); // 300s matches maxDuration
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      console.warn(`[pi-harness] Timeout after ${timeoutMs}ms [${threadId}]`);
      abortController.abort(new Error(`Pi run timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  const runEntry: ActiveRun = {
    threadId,
    modelName: effectiveModel,
    abortController,
    timeoutId,
    startedAt,
  };
  activeRuns.set(threadId, runEntry);
  console.log(`[pi-harness] Starting Pi run [${threadId}] model=${effectiveModel} concurrency=${activeRuns.size}`);

  // Ensure cleanup in all exit paths (deterministic resource cleanup)
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timeoutId) clearTimeout(timeoutId);
    try { clearInterval(heartbeatId); } catch {}
    if (externalAbortHandler && config.request?.signal) {
      try {
        (config.request.signal as AbortSignal).removeEventListener("abort", externalAbortHandler);
      } catch {}
    }
    activeRuns.delete(threadId);
    console.log(`[pi-harness] Cleaned run [${threadId}] duration=${Date.now() - startedAt}ms active=${activeRuns.size}`);
  };

  // Handle AbortSignal abort as explicit Pi interruption (stream interruption)
  abortController.signal.addEventListener?.(
    "abort",
    () => {
      console.log(`[pi-harness] Abort event [${threadId}]:`, (abortController.signal as any).reason ?? "no reason");
    },
    { once: true }
  );

  try {
    const outcome = await runPiWithVercel(
      writer,
      {
        ...config,
        threadId,
        modelName: effectiveModel,
        resumeNotice: resumeInfo?.notice,
        traceId,
      },
      abortController.signal,
    );
    if (abortController.signal.aborted) {
      await finishRun(threadId, "cancelled", { error: String((abortController.signal as any).reason?.message || "Aborted") });
      await runSpan.end("cancelled");
    } else if (outcome?.verification?.checked && !outcome.verification.complete) {
      // The model stopped, but independent checks say the work is not done.
      // Record it as interrupted so the next run resumes from real state
      // instead of pretending the task completed.
      const reasons = outcome.verification.reasons.join("; ").slice(0, 800);
      await finishRun(threadId, "interrupted", { error: `Completion unverified: ${reasons}` });
      await runSpan.end("error", { verification: "unverified", reasons: reasons.slice(0, 300) });
    } else {
      await finishRun(threadId, "completed");
      await heartbeatRun(threadId);
      await runSpan.end("ok");
    }
  } catch (e: any) {
    // Distinguish cancellation vs timeout vs init failure vs tool/stream failure
    const isAbort =
      e?.name === "AbortError" ||
      /aborted|cancelled|shutdown|AbortError/i.test(e?.message || String(e)) ||
      abortController.signal.aborted;

    if (isAbort) {
      const reason = (abortController.signal as any).reason?.message || e?.message || "Cancelled";
      const isTimeout = /timed out/i.test(reason);
      console.warn(`[pi-harness] Run ${isTimeout ? "timeout" : "cancelled"} [${threadId}]:`, reason);
      await finishRun(threadId, isTimeout ? "failed" : "cancelled", { error: reason });
      await runSpan.end("cancelled", { reason, timeout: isTimeout });
      try {
        const id = `pi-${isTimeout ? "timeout" : "cancel"}-${Date.now()}`;
        writer.write({ type: "text-start", id } as any);
        writer.write({
          type: "text-delta",
          id,
          delta: isTimeout ? `Request timed out after ${timeoutMs}ms: ${reason}` : `Cancelled: ${reason}`,
        } as any);
        writer.write({ type: "text-end", id } as any);
      } catch {}
      // Don't rethrow timeout as unhandled — writer already informed; throw to signal upstream if needed
      if (isTimeout) throw new Error(reason);
      return;
    }

    // Agent initialization failures or tool execution failures already surfaced via writer in inner function;
    // but ensure we log and propagate explicitly
    const msg = e?.message || String(e);
    console.error(`[pi-harness] Run failed [${threadId}]:`, msg.slice(0, 1000));
    await finishRun(threadId, "failed", { error: msg });
    await runSpan.end("error", { error: msg.slice(0, 500) });
    // If inner didn't write, ensure error visible
    try {
      // Heuristic: if nothing was written, writer will have no text; try to emit error text
      const id = `pi-error-${Date.now()}`;
      writer.write({ type: "text-start", id } as any);
      writer.write({ type: "text-delta", id, delta: `Pi execution error: ${msg.slice(0, 2000)}` } as any);
      writer.write({ type: "text-end", id } as any);
    } catch {}
    throw e;
  } finally {
    cleanup();
  }
}

async function runPiWithVercel(
  writer: any,
  config: PiConfig & { threadId: string; modelName: string; resumeNotice?: string; traceId?: string },
  signal: AbortSignal,
): Promise<{ verification: VerificationResult | null; sawError: boolean }> {
  const { streamText } = await import("ai");

  // Skills + connectors resolve before prompt build (progressive disclosure)
  const skills = resolveSkills(config);
  let connectorNames: string[] = [];
  try {
    const { getConnectedToolkits, resolveComposioUserId } = await import("@/lib/connectors/composio");
    connectorNames = await getConnectedToolkits(resolveComposioUserId(config.instanceId)).catch(() => [] as string[]);
  } catch {}

  // Build system prompt (preserves custom instructions)
  let systemPrompt = buildPiSystemPromptWithCustom(config.customSystemPrompt, {
    skills,
    connectors: connectorNames,
    userName: config.userName,
    userAbout: config.userAbout,
  });

  // Repository-local guidance (AGENTS.md / CLAUDE.md / .qube rules), bounded
  // and cached. It is user-provided project context, not a system override.
  try {
    const { loadProjectInstructions } = await import("./project-instructions");
    const project = await loadProjectInstructions(getWorkspacePath());
    if (project.block) systemPrompt += `\n\n${project.block}`;
  } catch (e: any) {
    console.warn("[pi-harness] Project instructions load failed (non-fatal):", e?.message || String(e));
  }

  // One-time resume notice from the execution ledger. Bounded, verified
  // history — the model is told to check the real state before continuing.
  if (config.resumeNotice) {
    systemPrompt += `\n\n## Resumed execution state\n${config.resumeNotice}`;
  }

  // Memory recall (under the hood): relevant memories + past-chat index.
  // Non-fatal by design — an empty context simply means nothing recalled yet.
  // Skipped entirely when long-term memory is disabled in Advanced settings.
  const memoryEnabled = resolveMemoryEnabled(config.memoryEnabled);
  if (memoryEnabled) {
    try {
      const { buildMemoryContext } = await import("./memory-context");
      const memCtx = await buildMemoryContext(
        config.messages as Array<Record<string, unknown>>,
        config.threadId,
      );
      if (memCtx) systemPrompt += `\n\n${memCtx}`;
    } catch (e: any) {
      console.warn("[pi-harness] Memory recall failed (non-fatal):", e?.message || String(e));
    }
  }

  // Rakazo parity: open scratchpad items as bounded <scratchpad_open> context
  // (data, not instructions) so open work survives turns without bloating.
  try {
    const { readScratchpad } = await import("./scratchpad");
    const { formatScratchpadOpen } = await import("./prompt-context");
    const raw = await readScratchpad(config.threadId).catch(() => null);
    if (raw && raw.trim()) {
      const items = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\s*[-*]\s*\[[ xX]?\]/u.test(l) || /^\s*[-*]\s+/u.test(l))
        .slice(0, 40)
        .map((line, i) => ({
          id: `s${i + 1}`,
          title: line.replace(/^\s*[-*]\s*(\[[ xX]?\]\s*)?/u, "").slice(0, 160) || line.slice(0, 160),
          notes: "",
          status: /\[x\]/iu.test(line) ? "done" : "open",
        }))
        .filter((it) => it.status !== "done");
      const block = formatScratchpadOpen(items);
      if (block) systemPrompt += `\n\n${block}`;
    }
  } catch {}

  // Reasoning effort mapping. The providerOptions key is the AI SDK provider
  // name, not the Qube provider id: every OpenAI-compatible provider
  // (openai, deepseek, openrouter, ollama, custom, opencode/zen, chatgpt
  // proxy, …) is a createOpenAI() client, so `openai.reasoningEffort` is
  // forwarded as `reasoning_effort` on all of them. Only mistral uses its
  // own SDK key. Previously only openai/mistral/chatgpt were mapped and
  // thinking was silently dropped for every other provider.
  const provResult = providerStore.getProviderByModel(config.modelName || "");
  const providerId = provResult?.provider.id;
  const providerOptions: Record<string, any> = {};
  const effort = config.reasoningEffort;
  if (effort && effort !== "off") {
    if (providerId === "mistral") providerOptions.mistral = { reasoningEffort: effort };
    else providerOptions.openai = { reasoningEffort: effort };
  }
  // Prompt caching (OpenAI-compatible providers only): send a stable cache key
  // per thread so the system prompt + conversation prefix are cached upstream.
  // Subsequent turns in the same thread hit the cache on the shared prefix,
  // cutting input token cost roughly in half. Only applies to non-mistral
  // providers (mistral uses its own SDK key, not providerOptions.openai).
  if (providerId !== "mistral" && config.threadId) {
    providerOptions.openai ??= {};
    providerOptions.openai.promptCacheKey = config.threadId;
    providerOptions.openai.promptCacheRetention = "24h";
  }

  const resolveModel = (modelId?: string | null) => {
    const target = modelId || config.modelName || "";
    const r = providerStore.getProviderByModel(target);
    if (r?.provider.id === "chatgpt") {
      if (!config.request) throw new Error(`ChatGPT model "${target}" requires request context.`);
      return createPiModelClientForRequest(target, config.request);
    }
    return createPiModelClient(target);
  };

  // Validate model client creation (agent initialization failure)
  let model: any;
  try {
    model = resolveModel(config.modelName);
  } catch (e: any) {
    console.error("[pi-harness] Model client init failed:", e.message);
    throw e;
  }

  // Tool creation with permission gating (tool execution failures handled per-tool)
  let tools: Record<string, any>;
  let mcpClients: Awaited<ReturnType<typeof loadMcpTools>>["clients"] = [];
  try {
    tools = createPiTools(config.threadId, {
      includeSubagents: true,
      includeTodos: true,
      parentModelName: config.modelName,
      request: config.request,
      userRequest: config.userRequest,
      threadIdForScratchpad: config.threadId,
    });
    // Agent tools: schedules, heartbeat, user questions (goals=TodoWrite above)
    try {
      const { createPiAgentTools } = await import("./agent-tools");
      const agentTools = createPiAgentTools({ threadId: config.threadId });
      tools = { ...tools, ...agentTools };
    } catch (e: any) {
      console.warn("[pi-harness] Agent tools load failed (non-fatal):", e?.message || String(e));
    }
    // Memory tools: unified recall across all chats + past-session recall (under the hood)
    // Omitted entirely when long-term memory is disabled so the model cannot
    // read or write persistent memory for this run.
    if (memoryEnabled) {
      try {
        const { createPiMemoryTools } = await import("./memory-tools");
        const memoryTools = createPiMemoryTools(config.threadId);
        tools = { ...tools, ...memoryTools };
      } catch (e: any) {
        console.warn("[pi-harness] Memory tools load failed (non-fatal):", e?.message || String(e));
      }
    }
  } catch (e: any) {
    console.error("[pi-harness] Tool creation failed:", e.message);
    throw new Error(`Failed to initialize Pi tools: ${e.message}`);
  }

  // Connectors: Composio external service tools — isolated, non-fatal.
  // Every connector tool goes through the unified permission middleware so
  // the Advanced hard limits (connectors / destructive actions) are enforced
  // even for reads. Sensitive writes are self-reviewed; only an escalation
  // reaches the PermissionBar. Read-only lookups pass through.
  try {
    const { loadConnectorTools } = await import("./connectors");
    const conn = await loadConnectorTools(config.instanceId);
    if (Object.keys(conn.tools).length > 0) {
      console.log(`[pi-harness] Merging ${Object.keys(conn.tools).length} connector tools for thread ${config.threadId}`);
      try {
        const { withPermissionCheck } = await import("@/lib/middleware/permission-middleware");
        for (const [name, def] of Object.entries(conn.tools as Record<string, any>)) {
          const origExecute = (def as any)?.execute;
          if (typeof origExecute !== "function") continue;
          const bound = origExecute.bind(def);
          (def as any).execute = async (args: any, extra?: any) => {
            const input = typeof args === "object" && args !== null ? args : {};
            try {
              return await withPermissionCheck(
                name,
                input,
                config.threadId,
                (gated: any) => bound(gated, extra),
                {
                  category: "connector",
                  modelName: config.modelName,
                  request: config.request,
                  userRequest: config.userRequest,
                },
              );
            } catch (e: any) {
              return `Connector action failed: ${e?.message || String(e)}`.slice(0, 1000);
            }
          };
        }
      } catch (e: any) {
        console.warn("[pi-harness] Connector permission wrap failed (non-fatal):", e?.message || String(e));
      }
      tools = { ...tools, ...conn.tools };
    }
    if (conn.connected.length > 0) connectorNames = conn.connected;
  } catch (e: any) {
    console.error("[pi-harness] Connector load failed (non-fatal):", e.message);
  }

  // MCP: load custom servers (advanced settings) — failures are isolated per server
  try {
    const mcpResult = await loadMcpTools({ threadId: config.threadId, servers: config.mcpServers });
    if (Object.keys(mcpResult.tools).length > 0) {
      console.log(`[pi-harness] Merging ${Object.keys(mcpResult.tools).length} MCP tools for thread ${config.threadId}`);
      tools = { ...tools, ...mcpResult.tools };
    }
    mcpClients = mcpResult.clients;
    if (mcpResult.errors.length > 0) {
      console.warn(`[pi-harness] ${mcpResult.errors.length} MCP server(s) failed to load:`, mcpResult.errors.map((e) => `${e.name}:${e.error}`).join(" | ").slice(0, 500));
      // Surface MCP load errors to writer as visible warning (not fatal)
      try {
        const id = `pi-mcp-warn-${Date.now()}`;
        writer.write({ type: "text-start", id } as any);
        writer.write({ type: "text-delta", id, delta: `Warning: ${mcpResult.errors.length} MCP server(s) failed to start: ${mcpResult.errors.map((e) => `${e.name} (${e.error.slice(0, 100)})`).join(", ")}` } as any);
        writer.write({ type: "text-end", id } as any);
      } catch {}
    }
  } catch (e: any) {
    console.error("[pi-harness] MCP load failed (non-fatal):", e.message);
  }

  // Computer Use: OS-level control via open-codex-computer-use (`ocu`).
  // Native wrapper tools (computer_* prefix, no MCP collision). Failures are
  // isolated — a missing binary yields a helpful install hint per call.
  try {
    const { createComputerTools } = await import("./computer-tools");
    const { isComputerUseDisabled } = await import("./computer-use-mcp");
    if (!isComputerUseDisabled()) {
      const computerTools = createComputerTools(config.threadId, {
        includeAskUser: true,
        modelName: config.modelName,
        request: config.request,
        userRequest: config.userRequest,
      });
      console.log(`[pi-harness] Merging ${Object.keys(computerTools).length} computer-use tools for thread ${config.threadId}`);
      tools = { ...tools, ...computerTools };
    }
  } catch (e: any) {
    console.warn("[pi-harness] Computer-use tools load failed (non-fatal):", e?.message || String(e));
  }

  // Computer-use kernel: uniform describe → repeat-guard → permission →
  // execute → verify → recover → log pipeline for browser/computer tools.
  // Wraps BEFORE the observer below so lastToolError sees kernel results.
  try {
    const { applyKernel, kernelEnabled, StateTracker } = await import("@/lib/computer-use/index");
    if (kernelEnabled()) {
      applyKernel(tools as Record<string, any>, {
        threadId: config.threadId,
        interactive: true,
        modelName: config.modelName,
        request: config.request,
        userRequest: config.userRequest,
      });
      try {
        const resume = StateTracker.forThread(config.threadId).resumeContext();
        if (resume) systemPrompt += `\n\n${resume}`;
      } catch {}
    }
  } catch (e: any) {
    console.warn("[pi-harness] Kernel wrap failed (non-fatal):", (e?.message || String(e)).slice(0, 200));
  }

  // NOTE: Do NOT patch tool schemas here. Pi built-in tools already carry Zod
  // schemas, and MCP tools from @ai-sdk/mcp carry JSON-Schema (via jsonSchema(),
  // exposed as dynamic tools) — both shapes are natively supported by AI SDK v6
  // streamText. A previous defensive loop replaced any non-Zod inputSchema with
  // z.object({}).passthrough(), which silently destroyed MCP tools' real
  // parameters and caused the model to call MCP tools with missing/invalid args
  // in a retry loop. Validation only.
  for (const [name, def] of Object.entries(tools as Record<string, any>)) {
    const s: any = (def as any)?.inputSchema ?? (def as any)?.parameters;
    if (!s) {
      console.warn(`[pi-harness] Tool "${name}" has no inputSchema/parameters — model calls to it may fail`);
    }
  }

  // Silent goal continuation: observe the latest TodoWrite snapshot and the
  // most recent tool failure so that when a turn ends with unfinished goals,
  // the harness can nudge the model (via a server-side-only message, never
  // shown in the UI) to recover and keep working.
  // The transcript remains the store — this is just an in-run observer.
  let lastTodoSnapshot: TodoSnapshotItem[] | null = null;
  let lastToolError: string | null = null;
  let toolCallTotal = 0;
  let successfulToolCalls = 0;
  const filesTouched: string[] = [];
  const SELF_BOUNDED = new Set(["read_file", "read_tool_output", "list_directory", "run_command"]);
  try {
    for (const [toolName, toolDef] of Object.entries(tools as Record<string, any>)) {
      const origExecute = (toolDef as any)?.execute;
      if (typeof origExecute !== "function") continue;
      (toolDef as any).execute = async (...args: any[]) => {
        const startedAt = Date.now();
        const input = args?.[0];
        let writeAheadKey: string | null = null;
        try {
          if (toolName === "TodoWrite" && input && Array.isArray(input.todos)) {
            lastTodoSnapshot = input.todos as TodoSnapshotItem[];
            void setRunTodos(config.threadId, lastTodoSnapshot);
          }
        } catch {}

        // Idempotent replay: a file mutation from an interrupted run with the
        // same arguments returns its recorded result instead of writing twice.
        try {
          const replay = await findReplayableResult(config.threadId, toolName, input);
          if (replay) {
            toolCallTotal++;
            successfulToolCalls++;
            void logEvent({
              threadId: config.threadId,
              type: "tool_replay",
              status: "success",
              metadata: { tool: toolName, key: replay.key },
            });
            return replay.result;
          }
        } catch {}

        try {
          if (isMutatingToolName(toolName)) {
            writeAheadKey = await toolStarted(config.threadId, toolName, input, toolJournalKey(toolName, input));
          }
          const out = await (origExecute as (...a: any[]) => unknown)(...args);
          // Single source of truth for "did this tool call fail" (see
          // extractToolError): covers MCP isError, Pi JSON errors, and the
          // kernel's repeat-block/deny shapes, so a blocked repeat or a
          // denied action feeds recovery instead of looking clean.
          const err = extractToolError(toolName, out);
          lastToolError = err;
          toolCallTotal++;
          if (!err) successfulToolCalls++;
          if (!err) {
            try {
              const parsed = typeof out === "string" ? JSON.parse(out) : null;
              if (parsed?.path && (toolName === "write_file" || toolName === "edit_file")) {
                filesTouched.push(String(parsed.path));
                void recordFileTouched(config.threadId, String(parsed.path));
                void recordEvidence(config.threadId, "file_written", `${toolName}: ${parsed.path} (${parsed.size ?? "?"} bytes)`);
              }
              if (toolName === "run_command" && parsed?.exitCode === 0) {
                void recordEvidence(config.threadId, "command_ok", `${String(input?.command || "command").slice(0, 200)} (exit 0)`);
              }
              if (toolName === "delete_file" && parsed?.path) {
                void recordEvidence(config.threadId, "file_deleted", String(parsed.path));
              }
            } catch {}
          }
          if (writeAheadKey) {
            const preview = typeof out === "string" ? out.slice(0, 4_000) : JSON.stringify(out ?? "").slice(0, 4_000);
            void toolFinished(config.threadId, toolName, writeAheadKey, { ok: !err, result: preview, durationMs: Date.now() - startedAt });
          }
          if (toolCallTotal % 5 === 0) void heartbeatRun(config.threadId, { iterations: toolCallTotal });
          void logEvent({
            threadId: config.threadId,
            type: "tool_exec",
            status: err ? "error" : "success",
            latencyMs: Date.now() - startedAt,
            metadata: { tool: toolName, chars: typeof out === "string" ? out.length : undefined, error: err?.slice(0, 300) },
          });
          const bounded =
            typeof out === "string" && !SELF_BOUNDED.has(toolName)
              ? (await boundToolOutput(config.threadId, toolName, out)).text
              : out;
          return bounded;
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e);
          lastToolError = `${toolName}: ${msg.slice(0, 400)}`;
          toolCallTotal++;
          if (writeAheadKey) {
            void toolFinished(config.threadId, toolName, writeAheadKey, { ok: false, result: msg.slice(0, 1_000), durationMs: Date.now() - startedAt });
          }
          void logEvent({
            threadId: config.threadId,
            type: "tool_exec",
            status: "error",
            latencyMs: Date.now() - startedAt,
            metadata: { tool: toolName, error: msg.slice(0, 300) },
          });
          throw e;
        }
      };
    }
  } catch {}

  // Ensure MCP clients are closed when streaming ends or aborts — attach to signal and finally
  const closeMcp = async () => {
    // Snapshot open browser tabs FIRST: MCP teardown closes the agent's
    // pages, and the snapshot restores them next launch (stored session).
    try {
      const { snapshotBrowserTabs } = await import("@/lib/browser/tabs");
      await snapshotBrowserTabs();
    } catch {}
    if (mcpClients.length > 0) {
      try {
        await closeMcpClients(mcpClients);
        console.log(`[pi-harness] Closed ${mcpClients.length} MCP clients for ${config.threadId}`);
      } catch (e) {
        console.warn("[pi-harness] MCP close error:", e);
      }
    }
  };
  // Close on abort
  signal.addEventListener?.("abort", () => { void closeMcp(); }, { once: true });

  // Context compaction (preflight): shrink what the model sees when the
  // estimated request approaches the context window. Operates on UIMessages
  // (whole-message cuts only); the summary is injected into the system prompt.
  // Durable history on disk is untouched — only the next model call is reduced.
  let activeUiMessages = config.messages as Array<Record<string, unknown>>;
  const notifyCompaction = (info: { freshSummary: boolean; hardCut?: boolean; retried?: boolean; stats: any }) => {
    try {
      writer.write({
        type: "data-compaction",
        data: {
          compacted: true,
          freshSummary: info.freshSummary,
          hardCut: !!info.hardCut,
          retried: !!info.retried,
          keptMessages: info.stats?.keptMessages,
          droppedMessages: info.stats?.droppedMessages,
        },
      } as any);
    } catch {}
  };
  let estimatedPromptTokens = 0;
  let toolTokensEstimate = 0;
  const contextWindowTokens = resolveContextWindow(config.modelName).tokens;
  try {
    const { maybeCompactMessages } = await import("./compaction");
    const compactionSpan = startSpan(config.threadId, "context.compaction", { phase: "preflight" });
    const pre = await maybeCompactMessages({
      messages: activeUiMessages,
      threadId: config.threadId,
      systemPrompt,
      modelName: config.modelName,
      request: config.request,
      tools: tools as Record<string, unknown>,
    });
    if (pre.summaryBlock) systemPrompt += `\n\n${pre.summaryBlock}`;
    activeUiMessages = pre.messages;
    estimatedPromptTokens = pre.stats.estimatedTotalTokens;
    toolTokensEstimate = pre.stats.toolTokens ?? estimateToolDefinitionsTokens(tools as Record<string, any>).tokens;
    void logContextBudget(config.threadId, {
      estimatedTokens: pre.stats.estimatedTotalTokens,
      contextWindow: pre.stats.contextWindow || 0,
      thresholdTokens: pre.stats.thresholdTokens,
      toolTokens: pre.stats.toolTokens,
      calibrationFactor: pre.stats.calibrationFactor,
      compacted: pre.compacted,
      freshSummary: pre.freshSummary,
      hardCut: pre.hardCut,
    });
    if (pre.compacted) {
      try {
        const { buildContextManifest } = await import("./context-manifest");
        const manifest = await buildContextManifest({ threadId: config.threadId });
        if (manifest) systemPrompt += `\n\n${manifest}`;
      } catch {}
    }
    if (pre.freshSummary) notifyCompaction(pre);
    await compactionSpan.end("ok", {
      estimatedTokens: pre.stats.estimatedTotalTokens,
      thresholds: pre.stats.thresholdTokens,
      kept: pre.stats.keptMessages,
      dropped: pre.stats.droppedMessages,
      fresh: pre.freshSummary,
      validated: pre.stats.summaryValidated,
    });
  } catch (e: any) {
    console.warn("[pi-harness] Compaction preflight failed (non-fatal):", (e?.message || String(e)).slice(0, 200));
  }

  // Convert UIMessages to model messages (session recovery: full history provided)
  const { convertToModelMessages } = await import("ai");
  const toModelMessages = async (uiMessages: Array<Record<string, unknown>>): Promise<any> => {
    try {
      return await convertToModelMessages(uiMessages as any);
    } catch (e: any) {
      console.warn("[pi-harness] convertToModelMessages failed, using raw messages:", e.message);
      return uiMessages;
    }
  };

  // Check abort before starting stream (cancellation edge)
  if (signal.aborted) {
    throw new DOMException("Aborted before Pi stream start", "AbortError");
  }

  // Stream to writer with interruption handling. Up to 2 attempts: a provider
  // context-overflow error triggers one aggressive compaction + retry.
  // Separately, when a turn ends with unfinished TodoWrite goals, silent
  // server-side-only nudges (never shown in the UI) continue the work.
  let sawError = false;
  let toolCallCount = 0;
  let reader: ReadableStreamDefaultReader<any> | null = null;
  let overflowRetried = false;
  let silentRounds = 0;
  let completionVerification: VerificationResult | null = null;
  const silentBudget = maxSilentRounds();
  let verificationRounds = 0;
  const verificationBudget = maxVerificationRounds();
  const stepBudget = maxStepsPerRound();
  // Hard ceiling on rounds: initial + one overflow retry + silent budget +
  // verification budget + slack. Guarantees the outer loop is bounded even if
  // every continuation path somehow keeps returning.
  const roundLimit = computeRoundLimit(silentBudget, verificationBudget);
  // Server-side-only continuation history: this round's assistant/tool
  // messages plus the silent nudge. Never merged into activeUiMessages
  // (the client-visible history), so the nudge stays invisible in the UI.
  let pendingNudge: Array<Record<string, unknown>> = [];

  try {
    for (let attempt = 0; ; attempt++) {
      if (attempt > roundLimit) {
        console.warn(
          `[pi-harness] Round limit (${roundLimit}) reached [${config.threadId}] — stopping to avoid an unbounded loop`,
        );
        // Never let a safety stop look like a verified completion.
        completionVerification = {
          checked: true,
          complete: false,
          reasons: [`round limit (${roundLimit}) reached before completion could be verified`],
          evidence: [],
        };
        break;
      }
      const baseMessages = await toModelMessages(activeUiMessages);
      const modelMessages = [...baseMessages, ...pendingNudge];
      // Estimate what this round actually sends (system + tools + messages)
      // so provider prompt tokens can calibrate the estimator.
      estimatedPromptTokens =
        estimateTokens(systemPrompt) +
        toolTokensEstimate +
        estimateModelMessagesTokens(modelMessages);

      let result: any;
      try {
        result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages as any,
          maxRetries: 2,
          abortSignal: signal,
          stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= stepBudget,
          temperature: config.temperature !== undefined ? config.temperature : 0.3,
          ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
          tools: tools as any,
        });
      } catch (e: any) {
        const { isContextOverflowError } = await import("./compaction").catch(() => ({ isContextOverflowError: () => false as boolean }));
        if (isContextOverflowError(e) && !overflowRetried) {
          overflowRetried = true;
          console.warn(`[pi-harness] streamText overflow [${config.threadId}] — compacting + retrying`);
          const recovered = await recoverFromOverflow(activeUiMessages);
          if (recovered) continue;
        }
        console.error("[pi-harness] streamText init failed:", e.message);
        throw e;
      }

      const uiStream = result.toUIMessageStream({ originalMessages: activeUiMessages as any } as any) as ReadableStream<any>;
      reader = uiStream.getReader();
      let attemptOverflow = false;
      // Did THIS round produce visible assistant text? If so the turn is a
      // real answer and must not be re-run as an "idle" continuation.
      let producedText = false;

      while (true) {
        // Check abort between chunks
        if (signal.aborted) {
          throw new DOMException("Pi run aborted during streaming", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;

        // Count tool invocations so the post-task learning pass can gate on real effort.
        const chunkType = (value as any)?.type;
        if (
          chunkType === "tool-input-start" ||
          chunkType === "dynamic-tool-input-start" ||
          chunkType === "tool-call" ||
          chunkType === "dynamic-tool-call"
        ) {
          toolCallCount++;
        }
        if (chunkType === "text-delta" && typeof (value as any)?.delta === "string" && (value as any).delta.length > 0) {
          producedText = true;
        }

        // Surface error chunks as visible text (preserve UI contract)
        if (chunkType === "error") {
          const errText = (value as any).errorText || "An error occurred";
          const { isContextOverflowError } = await import("./compaction").catch(() => ({ isContextOverflowError: () => false as boolean }));
          if (isContextOverflowError(errText) && !overflowRetried) {
            // Don't surface the overflow as chat text — compact + retry instead.
            attemptOverflow = true;
            try {
              await reader.cancel();
            } catch {}
            break;
          }
          sawError = true;
          const hint = formatProviderError(errText, config.modelName);
          const id = `pi-error-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
          try {
            writer.write({ type: "text-start", id } as any);
            writer.write({ type: "text-delta", id, delta: hint } as any);
            writer.write({ type: "text-end", id } as any);
          } catch (writeErr) {
            // Streaming interruption: writer write failed (client disconnected)
            console.warn("[pi-harness] Writer write failed (stream interruption):", (writeErr as Error).message);
            throw new Error(`Streaming interrupted: ${(writeErr as Error).message}`);
          }
          continue;
        }

        try {
          writer.write(value);
        } catch (writeErr: any) {
          console.warn("[pi-harness] Writer write failed mid-stream [", config.threadId, "]:", writeErr.message);
          // Streaming interruption — propagate as cancellation vs error based on signal
          if (signal.aborted) {
            throw new DOMException("Writer interruption due to abort", "AbortError");
          }
          throw new Error(`Streaming interrupted: ${writeErr.message}`);
        }
      }

      // Provider usage is the ground truth for prompt size. Log it and fold
      // the estimated/actual ratio into the per-thread calibration (EWMA) so
      // compaction thresholds track the real tokenizer instead of chars/4.
      if (!attemptOverflow && !signal.aborted) {
        try {
          const usage = await Promise.resolve((result as any)?.usage);
          if (usage) {
            const promptTokens = Number(usage.inputTokens ?? usage.promptTokens ?? 0);
            const completionTokens = Number(usage.outputTokens ?? usage.completionTokens ?? 0);
            const totalTokens = Number(usage.totalTokens ?? (promptTokens + completionTokens));
            const cachedInputTokens = Number(
              usage.cachedInputTokens ?? usage.cachedInputTokenCount ?? usage.cacheReadInputTokens ?? 0,
            );
            // Some gateways (OpenRouter, custom OpenAI-compatible proxies)
            // return a real USD cost alongside usage. Prefer it over list-price
            // math; otherwise the UI hides cost entirely when no price data is
            // configured.
            const rawCost =
              (usage as any)?.cost ??
              (usage as any)?.totalCost ??
              (usage as any)?.raw?.cost ??
              (result as any)?.providerMetadata?.openrouter?.usage?.cost;
            const reportedCost = Number(rawCost);
            let calibrationFactor: number | undefined;
            if (promptTokens > 0) {
              calibrationFactor = await recordContextCalibration(
                config.threadId,
                estimatedPromptTokens,
                promptTokens,
              );
            }
            void logModelUsage(config.threadId, {
              promptTokens: promptTokens || undefined,
              completionTokens: completionTokens || undefined,
              totalTokens: totalTokens || undefined,
              cachedInputTokens: cachedInputTokens || undefined,
              estimatedTokens: estimatedPromptTokens || undefined,
              calibrationFactor,
              ...(Number.isFinite(reportedCost) && reportedCost >= 0 ? { cost: reportedCost } : {}),
              model: config.modelName,
              round: attempt + 1,
            });
          }
        } catch {
          // Usage is telemetry only — never fail a run over it.
        }
      }

      if (attemptOverflow && !overflowRetried) {
        overflowRetried = true;
        console.warn(`[pi-harness] Context overflow [${config.threadId}] — compacting + retrying`);
        const recovered = await recoverFromOverflow(activeUiMessages);
        if (recovered) continue;
      }

      // Silent goal continuation: the turn ended but TodoWrite goals are
      // unfinished. Append this round's messages plus a silent nudge
      // (server-side only — never written to the UI stream) and run another
      // round so the agent finishes all goals within the same turn.
      if (!sawError && !signal.aborted && hasUnfinishedGoals(lastTodoSnapshot) && silentRounds < silentBudget) {
        const incomplete = getIncompleteTodos(lastTodoSnapshot);
        let roundMessages: Array<Record<string, unknown>> = [];
        try {
          const response = await result?.response;
          if (response && Array.isArray((response as any).messages)) {
            roundMessages = (response as any).messages as Array<Record<string, unknown>>;
          }
        } catch {}
        pendingNudge = [
          ...pendingNudge,
          ...roundMessages,
          { role: "user", content: buildContinuationNudge(incomplete, lastToolError) } as Record<string, unknown>,
        ];
        silentRounds++;
        console.log(
          `[pi-harness] Silent continuation ${silentRounds}/${silentBudget} [${config.threadId}] — ${incomplete.length} goal(s) unfinished`
        );
        continue;
      }
      if (lastTodoSnapshot && silentRounds >= silentBudget && hasUnfinishedGoals(lastTodoSnapshot)) {
        console.warn(
          `[pi-harness] Silent continuation budget exhausted [${config.threadId}] — ${getIncompleteTodos(lastTodoSnapshot).length} goal(s) still unfinished`
        );
      }
      // Failure recovery: the turn ran tools and ended right after one
      // FAILED, with no TodoWrite plan to trigger the goal path above
      // (typical for demos / ad-hoc browser runs — the model narrates the
      // failure and quits). Nudge once per failure: lastToolError is
      // consumed here, so a NEW failure is required to nudge again.
      if (!sawError && !signal.aborted && !hasUnfinishedGoals(lastTodoSnapshot) && shouldRecoverContinue({ toolCallCount, lastError: lastToolError, silentRounds, budget: silentBudget })) {
        const err = String(lastToolError);
        lastToolError = null;
        let roundMessages: Array<Record<string, unknown>> = [];
        try {
          const response = await result?.response;
          if (response && Array.isArray((response as any).messages)) {
            roundMessages = (response as any).messages as Array<Record<string, unknown>>;
          }
        } catch {}
        pendingNudge = [
          ...pendingNudge,
          ...roundMessages,
          { role: "user", content: buildRecoveryNudge(err) } as Record<string, unknown>,
        ];
        silentRounds++;
        console.log(
          `[pi-harness] Failure recovery continuation ${silentRounds}/${silentBudget} [${config.threadId}] — ${err.slice(0, 120)}`
        );
        continue;
      }
      // Stall recovery only: if the round produced NEITHER tool calls NOR
      // visible text, the model ended with nothing actionable — nudge it
      // once to act. A round that already spoke (greetings, direct answers,
      // Q&A) IS the answer, so it must never be re-run: previously any
      // tool-less turn was re-continued up to the silent budget, which
      // streamed the same reply many times for a simple "hi".
      if (!sawError && !signal.aborted && shouldIdleContinue({ toolCallCount, producedText, silentRounds, budget: silentBudget })) {
        pendingNudge = [...pendingNudge, { role: "user", content: buildIdleContinueNudge(silentRounds) } as Record<string, unknown>];
        silentRounds++;
        console.log(`[pi-harness] Idle stall recovery ${silentRounds}/${silentBudget} [${config.threadId}] — no text or tools produced`);
        continue;
      }

      // Programmatic completion gate. A turn is not complete because the model
      // says so: todos, successful tool calls, the last error and the files
      // claimed on disk are checked independently. Pure Q&A turns (no tools,
      // todos or files) are "not checked" and pass straight through.
      const verification = await verifyCompletion({
        todos: lastTodoSnapshot,
        toolCalls: toolCallTotal,
        successfulToolCalls,
        producedText,
        sawError,
        lastToolError,
        filesTouched,
      });
      completionVerification = verification;
      void logVerification(config.threadId, verification);
      if (verification.checked) {
        try {
          writer.write({
            type: "data-verification",
            data: {
              checked: true,
              complete: verification.complete,
              reasons: verification.reasons.slice(0, 6),
            },
          } as any);
        } catch {}
        if (verification.complete) {
          void recordEvidence(config.threadId, "task_verified", verification.evidence.join("; ").slice(0, 600));
        } else {
          void recordEvidence(
            config.threadId,
            "verification_failed",
            verification.reasons.join("; ").slice(0, 600),
          );
        }
      }
      if (verification.checked && !verification.complete && !sawError && !signal.aborted) {
        if (verificationRounds < verificationBudget) {
          verificationRounds++;
          let roundMessages: Array<Record<string, unknown>> = [];
          try {
            const response = await result?.response;
            if (response && Array.isArray((response as any).messages)) {
              roundMessages = (response as any).messages as Array<Record<string, unknown>>;
            }
          } catch {}
          pendingNudge = [
            ...pendingNudge,
            ...roundMessages,
            { role: "user", content: buildVerificationNudge(verification) } as Record<string, unknown>,
          ];
          console.log(
            `[pi-harness] Completion verification failed ${verificationRounds}/${verificationBudget} [${config.threadId}] — ${verification.reasons.slice(0, 3).join("; ").slice(0, 240)}`
          );
          continue;
        }
        // Retry budget exhausted: never silently claim success. Put the
        // unverified note in the visible answer and keep the ledger honest.
        try {
          const id = `pi-verify-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
          writer.write({ type: "text-start", id } as any);
          writer.write({ type: "text-delta", id, delta: `\n\n${formatUnverifiedNote(verification)}` } as any);
          writer.write({ type: "text-end", id } as any);
        } catch {}
        console.warn(
          `[pi-harness] Completion unverified after ${verificationBudget} retry round(s) [${config.threadId}] — ${verification.reasons.slice(0, 3).join("; ").slice(0, 240)}`
        );
      }
      break;
    }

    async function recoverFromOverflow(
      uiMessages: Array<Record<string, unknown>>,
    ): Promise<boolean> {
      try {
        const { maybeCompactMessages } = await import("./compaction");
        const rec = await maybeCompactMessages({
          messages: uiMessages,
          threadId: config.threadId,
          systemPrompt,
          modelName: config.modelName,
          request: config.request,
          tools: tools as Record<string, unknown>,
          force: true,
          aggressive: true,
        });
        if (rec.compacted && rec.messages.length < uiMessages.length) {
          if (rec.summaryBlock) systemPrompt += `\n\n${rec.summaryBlock}`;
          activeUiMessages = rec.messages;
          estimatedPromptTokens = rec.stats.estimatedTotalTokens;
          toolTokensEstimate = rec.stats.toolTokens ?? toolTokensEstimate;
          // Summaries are lossy; re-inject authoritative machine state.
          try {
            const { buildContextManifest } = await import("./context-manifest");
            const manifest = await buildContextManifest({ threadId: config.threadId });
            if (manifest) systemPrompt += `\n\n${manifest}`;
          } catch {}
          notifyCompaction({ ...rec, retried: true });
          return true;
        }
      } catch (e: any) {
        console.warn("[pi-harness] Overflow recovery failed:", (e?.message || String(e)).slice(0, 200));
      }
      return false;
    }
  } catch (e: any) {
    // Distinguish tool execution failures vs transport/stream failures
    const isAbort =
      e?.name === "AbortError" ||
      signal.aborted ||
      /aborted|cancelled/i.test(e?.message || String(e));

    if (isAbort) {
      console.log(`[pi-harness] Streaming aborted [${config.threadId}]`);
      throw e; // propagate as abort to outer
    }

    // Tool failures already handled via error chunks; for unexpected failures, emit text
    const msg = e?.message || String(e);
    const hint = formatProviderError(msg, config.modelName, true);
    const id = `pi-stream-error-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
    try {
      writer.write({ type: "text-start", id } as any);
      writer.write({ type: "text-delta", id, delta: hint } as any);
      writer.write({ type: "text-end", id } as any);
    } catch {}
    console.error("[pi-harness] Pi stream failed:", msg.slice(0, 1000));
    throw e;
  } finally {
    try {
      await reader?.cancel().catch(() => {});
    } catch {}
    try {
      reader?.releaseLock();
    } catch {}
    // Ensure MCP clients are closed even if stream succeeded/failed/aborted
    try {
      await closeMcp();
    } catch {}
    // Verify that if we saw only errors, we already emitted text; ensure stream not empty
    if (sawError) {
      console.log(`[pi-harness] Completed with errors surfaced [${config.threadId}]`);
    }
    // Deterministic background observation (under the hood, fire-and-forget, non-fatal)
    // Skipped when long-term memory is disabled — nothing new is learned.
    if (memoryEnabled) {
      try {
        const { extractAndSaveMemories } = await import("./memory-context");
        extractAndSaveMemories(config.messages as Array<Record<string, unknown>>, config.threadId);
      } catch {}
      // Post-task learning pass (§§4,22): generalize, persist, skill-extract,
      // evaluate proactivity. Fire-and-forget, bounded, never blocks response.
      try {
        const lastUser = [...(config.messages as any[])].reverse().find((m: any) => m.role === "user");
        const textOf = (m: any): string => {
          try {
            const parts = m?.parts || m?.content;
            if (Array.isArray(parts)) return parts.map((p: any) => p?.text || "").join(" ").slice(0, 800);
            return typeof parts === "string" ? parts.slice(0, 800) : "";
          } catch { return ""; }
        };
        const userText = lastUser ? textOf(lastUser) : "";
        if (userText && userText.trim().length >= 8 && !sawError) {
          const { runPostTaskLearning } = await import("@/lib/learning/protocol");
          void runPostTaskLearning({
            threadId: config.threadId,
            userText,
            taskSuccess: !sawError,
            toolCalls: toolCallCount,
            filesChanged: 0,
            backgroundSupported: true,
          }).catch(() => {});
        }
      } catch {}
    }
  }
  return { verification: completionVerification, sawError };
}

// ---------- Public control plane for Pi ----------

export function cancelPiRun(threadId: string): boolean {
  const run = activeRuns.get(threadId);
  if (!run) return false;
  console.log(`[pi-harness] Cancel requested [${threadId}]`);
  run.abortController.abort(new Error("Cancelled by caller"));
  if (run.timeoutId) clearTimeout(run.timeoutId);
  return true;
}

export function isPiRunActive(threadId: string): boolean {
  return activeRuns.has(threadId);
}

export function getActivePiRuns(): Array<{ threadId: string; modelName: string; startedAt: number }> {
  return Array.from(activeRuns.values()).map((r) => ({
    threadId: r.threadId,
    modelName: r.modelName,
    startedAt: r.startedAt,
  }));
}

export async function shutdownPiHarness(): Promise<void> {
  console.log(`[pi-harness] Shutdown requested, aborting ${activeRuns.size} runs`);
  for (const [tid, run] of activeRuns.entries()) {
    try {
      run.abortController.abort(new Error("Pi harness shutdown"));
      if (run.timeoutId) clearTimeout(run.timeoutId);
    } catch {}
  }
  activeRuns.clear();
}

// Legacy compatibility — route previously imported runCodexHarness
export const runCodexHarness = runPiHarness;

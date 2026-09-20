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
  type TodoSnapshotItem,
} from "./continuation";
import type { McpServerConfig } from "./mcp-store";
import type { SkillConfig } from "@/lib/skills/types";

export type PiConfig = {
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  reasoningEffort?: string;
  request?: Request;
  mcpServers?: McpServerConfig[];
  instanceId?: string;
  skills?: SkillConfig[];
  userName?: string;
  userAbout?: string;
  memoryEnabled?: boolean;
};

export function resolveMemoryEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { settingsStore } = require("@/lib/settings-store") as typeof import("@/lib/settings-store");
    const s = settingsStore.getAll();
    // Default ON for backward compat; only explicit false disables.
    if (s.memoryEnabled === false) return false;
    return true;
  } catch {
    return true;
  }
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
const MAX_CONCURRENT_RUNS = 32;

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
    try {
      const id = `pi-steer-${Date.now()}`;
      writer.write({ type: "text-start", id } as any);
      writer.write({ type: "text-delta", id, delta: `Steered — incorporating your latest message…` } as any);
      writer.write({ type: "text-end", id } as any);
    } catch {}
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

  // 4) Set up cancellation / timeout / interruption
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
    await runPiWithVercel(writer, { ...config, threadId, modelName: effectiveModel }, abortController.signal);
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

async function runPiWithVercel(writer: any, config: PiConfig & { threadId: string; modelName: string }, signal: AbortSignal) {
  const { streamText } = await import("ai");

  // Skills + connectors resolve before prompt build (progressive disclosure)
  const skills = resolveSkills(config);
  let connectorNames: string[] = [];
  try {
    const { getConnectedToolkits, DEFAULT_USER_ID } = await import("@/lib/connectors/composio");
    connectorNames = await getConnectedToolkits(config.instanceId || DEFAULT_USER_ID).catch(() => [] as string[]);
  } catch {}

  // Build system prompt (preserves custom instructions)
  let systemPrompt = buildPiSystemPromptWithCustom(config.customSystemPrompt, {
    skills,
    connectors: connectorNames,
    userName: config.userName,
    userAbout: config.userAbout,
  });

  // VoiceMem recall (under the hood): relevant memories + past-chat index.
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

  // Provider/type resolution with reasoning effort mapping (preserve thinking-support behavior)
  const provResult = providerStore.getProviderByModel(config.modelName || "");
  const providerId = provResult?.provider.id;
  const providerOptions: Record<string, any> = {};
  const effort = config.reasoningEffort;
  if (effort && effort !== "off") {
    if (providerId === "openai") providerOptions.openai = { reasoningEffort: effort };
    else if (providerId === "mistral") providerOptions.mistral = { reasoningEffort: effort };
    else if (providerId === "chatgpt") providerOptions.openai = { reasoningEffort: effort };
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
    // Memory tools: VoiceMem recall across all chats + past-session recall (under the hood)
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

  // Connectors: Composio external service tools — isolated, non-fatal
  try {
    const { loadConnectorTools } = await import("./connectors");
    const conn = await loadConnectorTools(config.instanceId);
    if (Object.keys(conn.tools).length > 0) {
      console.log(`[pi-harness] Merging ${Object.keys(conn.tools).length} connector tools for thread ${config.threadId}`);
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
  try {
    for (const [toolName, toolDef] of Object.entries(tools as Record<string, any>)) {
      const origExecute = (toolDef as any)?.execute;
      if (typeof origExecute !== "function") continue;
      (toolDef as any).execute = async (...args: any[]) => {
        try {
          const input = args?.[0];
          if (toolName === "TodoWrite" && input && Array.isArray(input.todos)) {
            lastTodoSnapshot = input.todos as TodoSnapshotItem[];
          }
        } catch {}
        try {
          const out = await (origExecute as (...a: any[]) => unknown)(...args);
          if (out && typeof out === "object" && (out as any).isError === true) {
            // MCP-style error result (e.g. stale browser ref): remember it for
            // the continuation nudge, still return it so the model sees it now.
            try {
              const parts = (out as any).content;
              const text = Array.isArray(parts)
                ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim()
                : "";
              lastToolError = `${toolName}: ${(text || JSON.stringify(out)).slice(0, 400)}`;
            } catch {
              lastToolError = `${toolName}: tool reported an error`;
            }
          } else if (typeof out === "string" && /^error:/i.test(out.trim())) {
            lastToolError = `${toolName}: ${out.trim().slice(0, 400)}`;
          } else {
            // A clean result supersedes any earlier failure.
            lastToolError = null;
          }
          return out;
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e);
          lastToolError = `${toolName}: ${msg.slice(0, 400)}`;
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
  try {
    const { maybeCompactMessages } = await import("./compaction");
    const pre = await maybeCompactMessages({
      messages: activeUiMessages,
      threadId: config.threadId,
      systemPrompt,
      modelName: config.modelName,
      request: config.request,
    });
    if (pre.summaryBlock) systemPrompt += `\n\n${pre.summaryBlock}`;
    activeUiMessages = pre.messages;
    if (pre.freshSummary) notifyCompaction(pre);
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
  const silentBudget = maxSilentRounds();
  // Server-side-only continuation history: this round's assistant/tool
  // messages plus the silent nudge. Never merged into activeUiMessages
  // (the client-visible history), so the nudge stays invisible in the UI.
  let pendingNudge: Array<Record<string, unknown>> = [];

  try {
    for (let attempt = 0; ; attempt++) {
      const baseMessages = await toModelMessages(activeUiMessages);
      const modelMessages = [...baseMessages, ...pendingNudge];

      let result: any;
      try {
        result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages as any,
          maxRetries: 0,
          abortSignal: signal,
          stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= 15,
          temperature: config.temperature !== undefined ? config.temperature : 0.7,
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
          force: true,
          aggressive: true,
        });
        if (rec.compacted && rec.messages.length < uiMessages.length) {
          if (rec.summaryBlock) systemPrompt += `\n\n${rec.summaryBlock}`;
          activeUiMessages = rec.messages;
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
    // VoiceMem background extraction (under the hood, fire-and-forget, non-fatal)
    // Skipped when long-term memory is disabled — nothing new is learned.
    if (memoryEnabled) {
      try {
        const { extractAndSaveMemories } = await import("./memory-context");
        extractAndSaveMemories(config.messages as Array<Record<string, unknown>>);
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

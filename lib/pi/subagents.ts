/**
 * Pi Subagents — isolated child execution for Qube.
 *
 * Pattern (researched from pi-subagents, pi-spawn, Claude Code Task tool):
 * - `subagent` tool spawns a focused child with FRESH context (no parent history)
 * - Child inherits model (or default), runs with narrowed tool subset
 * - Recursion guard: child tools NEVER include `subagent`
 * - Output truncated to 2000 lines / 50KB (pi-sub-agent convention)
 * - Returns structured JSON {title, description, status, summary, steps}
 *   so the frontend can render the pill + popup with the same components
 *   as the main agent.
 */

import { providerStore } from "./provider-store";
import { createPiModelClient, createPiModelClientForRequest } from "./model-client";
import { createPiTools } from "./tools";
import { formatCurrentTimeInstruction } from "./prompt-context";

export type SubagentType = "Explore" | "general" | "researcher" | "reviewer";

export type SubagentStep =
  | { type: "thought"; content: string }
  | { type: "tool"; content: string; toolName: string; args?: any; result?: any }
  | { type: "text"; content: string };

export type SubagentResult = {
  title: string;
  description: string;
  subagentType: string;
  status: "completed" | "failed" | "running";
  summary: string;
  error?: string;
  task?: string;
  steps?: SubagentStep[];
  usage?: { reads: number; searches: number; tools: number };
};

const MAX_OUTPUT_CHARS = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;

function truncateOutput(text: string): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  let out = text;
  let truncated = false;
  if (lines.length > MAX_OUTPUT_LINES) {
    out = lines.slice(-MAX_OUTPUT_LINES).join("\n");
    truncated = true;
  }
  if (out.length > MAX_OUTPUT_CHARS) {
    out = out.slice(-MAX_OUTPUT_CHARS);
    truncated = true;
  }
  return { text: out, truncated };
}

// Active subagent runs (concurrency guard, max 4 like pi-subagents default)
const activeSubagents = new Map<string, { startedAt: number; description: string }>();
const MAX_CONCURRENT_SUBAGENTS = 4;

export function getActiveSubagentCount(): number {
  return activeSubagents.size;
}

export function buildSubagentSystemPrompt(agentType: string, skillsHint?: string): string {
  // Isolated fresh context: no parent history, so the model would otherwise
  // fall back to its training cutoff as "today" (e.g. refusing Sept 2026
  // research as "the future"). Anchor it to the real current time, same as
  // the main harness prompt.
  const base = `You are a Qube subagent. You run ISOLATED with a fresh context window — you do NOT see the parent conversation. ${formatCurrentTimeInstruction()} Work only from the task given. Be concise, use tools when needed, verify actions, and return a compressed summary (findings/decisions, not full logs).${skillsHint ? `\n\n## Skills available\n${skillsHint}` : ""}`;

  switch (agentType) {
    case "Explore":
      return `${base}

## Role: Explore (fast codebase recon)
- Fast local codebase recon: relevant files, entry points, data flow, risks.
- Prefer read_file, list_directory, web_search/web_fetch for context. Use run_command only for read-only inspection (ls, cat, grep, find).
- DO NOT write, edit, or delete files unless the task explicitly asks for implementation.
- Return: file paths, key findings, risks — compressed, structured.`;
    case "researcher":
      return `${base}

## Role: Researcher (web/docs research)
- Use web_search then web_fetch for details. Prefer primary sources.
- Return a concise research brief with sources (title + URL).`;
    case "reviewer":
      return `${base}

## Role: Reviewer (code review)
- Read-only review: correctness, edge cases, simplicity. Do not edit unless asked.
- Return: issues found, severity, suggested fixes with file paths.`;
    default:
      return `${base}

## Role: General delegate
- Behave close to the parent session. Use available tools to complete the task.
- Verify after tool calls. If a tool fails, retry once with a different strategy.`;
  }
}

function normalizeAgentType(input?: string): SubagentType {
  if (!input) return "general";
  const lower = input.toLowerCase();
  if (lower === "explore") return "Explore";
  if (lower === "researcher") return "researcher";
  if (lower === "reviewer") return "reviewer";
  if (lower.includes("explor")) return "Explore";
  if (lower.includes("research")) return "researcher";
  if (lower.includes("review")) return "reviewer";
  return "general";
}

export async function runSubagent(opts: {
  description: string;
  prompt: string;
  agentType?: string;
  parentThreadId: string;
  modelName?: string | null;
  request?: Request;
}): Promise<SubagentResult> {
  const agentType = normalizeAgentType(opts.agentType);
  const title = agentType; // pill shows "Explore <description>" like screenshots
  const asText = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
  const description = asText(opts.description || opts.prompt).slice(0, 120) || "Subagent task";
  const task = asText(opts.prompt);

  if (!task.trim()) {
    return {
      title,
      description,
      subagentType: agentType,
      status: "failed",
      summary: "",
      error: "Subagent task is empty.",
      task,
      steps: [],
    };
  }

  if (activeSubagents.size >= MAX_CONCURRENT_SUBAGENTS) {
    return {
      title,
      description,
      subagentType: agentType,
      status: "failed",
      summary: "",
      error: `Too many concurrent subagents (${MAX_CONCURRENT_SUBAGENTS}). Try again shortly.`,
      task,
      steps: [],
    };
  }

  const runId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  activeSubagents.set(runId, { startedAt: Date.now(), description });
  console.log(`[pi-subagent] Starting ${agentType} [${runId}] parent=${opts.parentThreadId} desc=${description.slice(0, 80)}`);

  try {
    // Resolve model: explicit > parent default > store default
    let effectiveModel = opts.modelName || "";
    if (!effectiveModel) {
      try {
        effectiveModel = providerStore.getDefaultModelId() || "";
      } catch {}
    }
    if (!effectiveModel) {
      return {
        title,
        description,
        subagentType: agentType,
        status: "failed",
        summary: "",
        error: "No model configured for subagent.",
        task,
        steps: [],
      };
    }

    let model: any;
    try {
      const prov = providerStore.getProviderByModel(effectiveModel);
      if (prov?.provider.id === "chatgpt") {
        if (!opts.request) throw new Error(`ChatGPT model "${effectiveModel}" requires request context.`);
        model = createPiModelClientForRequest(effectiveModel, opts.request);
      } else {
        model = createPiModelClient(effectiveModel);
      }
    } catch (e: any) {
      return {
        title,
        description,
        subagentType: agentType,
        status: "failed",
        summary: "",
        error: `Subagent model init failed: ${e.message}`,
        task,
        steps: [],
      };
    }

    // Child tools: narrowed subset, NEVER includes `subagent` (recursion guard)
    // matching pi-spawn + pi-sub-agent conventions.
    const allTools = createPiTools(`subagent_${runId}`, {
      // child must not spawn further subagents
      includeSubagents: false,
      includeTodos: false,
      // child runs headless — no interactive questioning
      includeAskUser: false,
      parentModelName: effectiveModel,
      request: opts.request,
    }) as Record<string, any>;

    let childTools: Record<string, any> = allTools;
    if (agentType === "Explore") {
      const allowed = ["read_file", "list_directory", "web_search", "web_fetch", "run_command"];
      childTools = Object.fromEntries(Object.entries(allTools).filter(([k]) => allowed.includes(k)));
    } else if (agentType === "researcher") {
      const allowed = ["web_search", "web_fetch"];
      childTools = Object.fromEntries(Object.entries(allTools).filter(([k]) => allowed.includes(k)));
    } else if (agentType === "reviewer") {
      const allowed = ["read_file", "list_directory", "web_search", "web_fetch"];
      childTools = Object.fromEntries(Object.entries(allTools).filter(([k]) => allowed.includes(k)));
    }

    const systemPrompt = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { skillStore } = require("@/lib/skills/store") as typeof import("@/lib/skills/store");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { skillTokenHint } = require("@/lib/skills/prompt") as typeof import("@/lib/skills/prompt");
        const skills = skillStore.getAll().filter((s: any) => s.disableModelInvocation !== true);
        if (skills.length === 0) return buildSubagentSystemPrompt(agentType);
        return buildSubagentSystemPrompt(agentType, `Installed: ${skillTokenHint(skills)}. Apply one when its description matches the task.`);
      } catch {
        return buildSubagentSystemPrompt(agentType);
      }
    })();
    // NOTE: must use streamText (not generateText) — model-client forces
    // stream:true on every fetch, which breaks generateText's JSON parsing
    // ("AI_APICallError: Invalid JSON response"). Same pattern as task-runner.
    const { streamText } = await import("ai");

    // Fresh context: only the task, no parent history (Claude Code isolation)
    const selfContainedPrompt = `Task: ${task}\n\nContext: You are running in directory workspace. All file paths are workspace-relative. Return a concise summary when done.`;

    const subTimeoutMs = parseInt(process.env.PI_SUBAGENT_TIMEOUT_MS || "180000", 10);
    const subController = new AbortController();
    let subTimeout: ReturnType<typeof setTimeout> | undefined;
    if (Number.isFinite(subTimeoutMs) && subTimeoutMs > 0) {
      subTimeout = setTimeout(() => subController.abort(new Error(`Subagent timed out after ${subTimeoutMs}ms`)), subTimeoutMs);
    }

    let result: any;
    try {
      result = streamText({
        model,
        system: systemPrompt,
        prompt: selfContainedPrompt,
        maxRetries: 0,
        abortSignal: subController.signal,
        temperature: 0.3,
        tools: childTools as any,
        stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= 12,
      } as any);

      // Consume the stream fully so steps/tool results materialize
      try {
        await result.consumeStream();
      } catch {}
    } finally {
      if (subTimeout) clearTimeout(subTimeout);
    }

    const rawSteps = (await (result as any).steps) as any[] | undefined;
    const steps: SubagentStep[] = [];
    let reads = 0;
    let searches = 0;

    const coerceStepText = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (v == null) return "";
      if (Array.isArray(v)) {
        return v
          .map((p) => {
            if (typeof p === "string") return p;
            if (p != null && typeof (p as any).text === "string") return (p as any).text;
            try {
              return JSON.stringify(p);
            } catch {
              return String(p);
            }
          })
          .join("\n");
      }
      if (typeof (v as any).text === "string") return (v as any).text;
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    };

    if (Array.isArray(rawSteps)) {
      for (const s of rawSteps) {
        // text output (AI SDK step text can be a string or content-part array)
        const text = coerceStepText(s?.text ?? s?.content);
        if (text.trim()) {
          steps.push({ type: "text", content: text.slice(0, 4000) });
        }
        // tool calls
        const toolCalls: any[] = s.toolCalls || [];
        const toolResults: any[] = s.toolResults || [];
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const tr = toolResults[i];
          const toolName: string = typeof tc?.toolName === "string" ? tc.toolName : typeof tc?.name === "string" ? tc.name : "tool";
          let args: any = tc?.args ?? tc?.input ?? {};
          let toolResult: any = tr?.result ?? tr?.output ?? tr;
          if (typeof toolResult !== "string" && toolResult != null) {
            try {
              toolResult = JSON.stringify(toolResult).slice(0, 8000);
            } catch {
              try {
                toolResult = String(toolResult).slice(0, 8000);
              } catch {
                toolResult = "[unserializable tool result]";
              }
            }
          }
          if (typeof toolResult === "string" && toolResult.length > 8000) {
            toolResult = toolResult.slice(-8000);
          }
          if (toolName === "read_file" || toolName === "list_directory") reads++;
          if (toolName === "web_search" || toolName === "web_fetch") searches++;
          let argsPreview = "";
          try {
            argsPreview = JSON.stringify(args).slice(0, 2000);
          } catch {
            argsPreview = String(args).slice(0, 2000);
          }
          steps.push({
            type: "tool",
            content: argsPreview,
            toolName,
            args,
            result: toolResult,
          });
        }
      }
    }

    const rawSummary = await (result as any).text;
    let summary: string = typeof rawSummary === "string" ? rawSummary : rawSummary == null ? "" : String(rawSummary);
    if (!summary && steps.length > 0) {
      // fallback: last text step
      const lastText = [...steps].reverse().find((s) => s.type === "text");
      summary = lastText?.content || "";
    }
    const { text: truncatedSummary, truncated } = truncateOutput(summary || "(no output)");
    if (truncated) {
      console.log(`[pi-subagent] Output truncated [${runId}]`);
    }

    console.log(
      `[pi-subagent] Completed ${agentType} [${runId}] steps=${steps.length} reads=${reads} searches=${searches} duration=${Date.now() - (activeSubagents.get(runId)?.startedAt || Date.now())}ms`
    );

    return {
      title,
      description,
      subagentType: agentType,
      status: "completed",
      summary: truncatedSummary,
      task,
      steps: steps.slice(-50), // cap for UI payload
      usage: { reads, searches, tools: steps.filter((s) => s.type === "tool").length },
    };
  } catch (e: any) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[pi-subagent] Failed [${runId}]:`, msg.slice(0, 500));
    return {
      title,
      description,
      subagentType: agentType,
      status: "failed",
      summary: "",
      error: msg.slice(0, 2000),
      task,
      steps: [],
    };
  } finally {
    activeSubagents.delete(runId);
  }
}

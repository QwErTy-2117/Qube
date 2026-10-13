/**
 * Pi task runner — non-streaming execution for scheduler/background tasks.
 * Uses Pi harness primitives (providerStore, modelClient, tools) but returns
 * final output string instead of streaming to UI writer.
 * Lifecycle owned by Pi (concurrency guard, timeout, cancellation, cleanup).
 */

import { providerStore } from "./provider-store";
import { createPiModelClient, isChatGPTModel } from "./model-client";

/**
 * Background tasks (heartbeat + scheduled) run headless with no HTTP request,
 * so ChatGPT subscription models cannot run here — they need the user's
 * session cookie via createPiModelClientForRequest(). Resolve a usable model:
 * prefer the default unless it is ChatGPT, then fall back to the first
 * enabled non-ChatGPT model. Returns { modelId, fallback } so callers can log.
 */
function resolveBackgroundModelId(): { modelId: string | null; fallback: boolean; requested: string | null } {
  const requested = providerStore.getDefaultModelId();
  if (!requested) return { modelId: null, fallback: false, requested };
  if (!isChatGPTModel(requested)) return { modelId: requested, fallback: false, requested };
  try {
    for (const p of providerStore.getAllProviders()) {
      if (p.id === "chatgpt") continue;
      if ((p as any).enabled === false) continue;
      const models = (p as any).models as Array<{ id: string; enabled?: boolean }> | undefined;
      if (Array.isArray(models)) {
        const enabled = models.find((m) => m.enabled !== false);
        if (enabled?.id && !isChatGPTModel(enabled.id)) {
          return { modelId: enabled.id, fallback: true, requested };
        }
      }
    }
  } catch {}
  return { modelId: requested, fallback: false, requested };
}
import { createPiTools } from "./tools";
import { formatCurrentTimeInstruction } from "./prompt-context";
import { loadMcpTools, closeMcpClients } from "./mcp";
import { createTaskPermissionChecker } from "@/lib/middleware/permission-middleware";
import { getWorkspacePath, resolvePathInWorkspace, relativePathInWorkspace, resolveExternalPath } from "@/lib/middleware/workspace";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { extname, join, dirname } from "node:path";
import { getMemoryEntries } from "@/lib/memory/memory-store";
import type { ScheduledTask } from "@/lib/scheduler/types";

const execAsync = promisify(exec);

async function scanGeneratedFiles() {
  const ws = getWorkspacePath();
  const generated: Array<{ name: string; relativePath: string; size: number }> = [];
  const now = Date.now();
  async function walk(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git") await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if ([".pptx", ".docx", ".xlsx", ".pdf", ".csv", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg"].includes(ext)) {
            try {
              const s = await stat(fullPath);
              const birth = s.birthtime?.getTime() || s.ctime.getTime();
              if (now - birth < 120_000) generated.push({ name: entry.name, relativePath: relativePathInWorkspace(fullPath), size: s.size });
            } catch {}
          }
        }
      }
    } catch {}
  }
  await walk(ws);
  return generated;
}

export function buildPiTaskSystemPrompt(task: ScheduledTask, heartbeatState?: string, skillsSection?: string, connectorHint?: string): string {
  const heartbeatContext = task.type === "heartbeat" && heartbeatState ? `\n\n## Heartbeat Context\n${heartbeatState}` : "";
  const heartbeatDiscipline =
    task.type === "heartbeat"
      ? `\n\n## Heartbeat discipline (Muse-style monitor — three lanes, never repeats)
- This is a flexible periodic inspection, NOT an exact-timed automation. You monitor WORKSPACE FILES + CONNECTORS (Gmail, GitHub, Calendar, Slack, Drive when connected) for things the user should know next time they talk.
- Steps every tick: (1) check pending/failed checklist first; (2) list_directory workspace root for new/changed files; (3) if connectors are connected, do READ-ONLY lookups (list/search/get — never send/post/delete) for fresh items (e.g. unread Gmail threads, new GitHub PR comments, today's calendar clashes).
- Three lanes — pick the least intrusive that gets the work pre-done:
  - Lane A (monitor): read-only checks. Save each new finding once via update_heartbeat note with evidence + a draft reply/action.
  - Lane B (prep — AUTHORIZED, reversible, in-workspace only): when you find work the user will clearly want done (a pending paper/deck/sheet to compile, a mess to tidy, a comparison table to build, a grocery list from a saved recipe), DO the reversible prep NOW with write_file/edit_file/run_command (non-destructive) under documents/, presentations/, spreadsheets/, images/, code/. Then save ONE update_heartbeat note with the file path + what to ask the user next chat (e.g. "Compiled paper — documents/thesis.pdf ready; ask if they want it sent"). Lane B never sends/posts/deletes/purchases externally.
  - Lane C (reaching people / outside world): NEVER headless (no user to approve) — prepare the draft or file first (Lane B), then surface it for approval in the next chat.
- NEVER repeat a suggestion twice: before noting, check the pending checklist / heartbeat state — if the same topic is already pending or was recently notified, skip it. No duplicate notes for the same emails/files.
- NEVER send, post, delete, purchase, or share externally headless (no user to approve) — READ + PREP ONLY. Recurring work belongs in scheduled tasks — do NOT create schedules from here and do NOT infer old tasks from prior chats.
- If nothing needs attention, return exactly HEARTBEAT_OK with no tool calls (quiet tick, idempotent). Act once, never repeat a completed action.`
      : `\n\n## Scheduled-task discipline (exact timing, isolated)
- This is an exact-timed automation with its own run history. Execute the instructions fully and autonomously.
- Your instructions WERE written (or approved) by the user, so they ARE your authorization: if they say to email, post, create, or delete something, DO it with the connector tools — do not draft-and-wait, do not ask (there is no user here). Draft-only applies to the heartbeat monitor, never to you.
- If a connector tool you need is MISSING from your tool list, that service is not connected. Say so plainly in your summary ("Gmail is not connected, so I saved the report to documents/... instead") — NEVER invent session-token, handshake, re-login, or "not active in this session" stories. Report only what tools actually returned.
- Done criteria first: read the Done criteria / Only-report-if / Deliverable lines in your instructions (appended at creation). A run that finds "no change" under an only-report-if rule stays silent — that is success, not failure.
- Verify before finishing: re-list every file you wrote (list_directory), re-fetch one edited URL, validate JSON you produced. Mark file deliverables with [file: path]. Report verified state (succeeded/partial/failed). Never claim work without tool results.`;
  return `You are Qube Pi background task "${task.name}" (${task.type}). You run via Pi harness without user supervision. ${formatCurrentTimeInstruction()}

## Your Task
${task.instructions}

## Available Tools
- Files: write_file, read_file, edit_file, delete_file, list_directory, list_external_directory, read_external_file, present_file
- Shell: run_command (respects task permissions: runCommands=${task.permissions.runCommands}, destructive=${task.permissions.destructiveCommands})
- Web: web_search, web_fetch (allowed=${task.permissions.webAccess})
- Memory: read_memory (persistent memory across sessions)
- Goals: TodoWrite(headless plan) — call it FIRST for work with 3+ steps, then flip items to completed the moment each finishes; pass the COMPLETE list each call, exactly one in_progress at a time. If your run ends with items unfinished you get another round to continue — keep working until everything is completed, then summarize.
- Subagents: subagent(description, prompt, agentType) — isolated child (Explore/researcher/reviewer/general). Use for recon that would flood context; validate outputs.
- Automations: schedule_task (create/list/update/delete/trigger), update_heartbeat (get/note/update) — manage future work from background runs. Heartbeat runs must NOT create schedules from here.
- ask_user always returns available=false headless — never block on it; proceed with best judgment.
- Connectors${connectorHint ? ` (connected: ${connectorHint})` : " (none connected — save file deliverables to the workspace instead of sending)"}: external service tools via Composio when connected (exact schemas at runtime).${task.type === "heartbeat" ? " Heartbeat lanes: Lane A monitor (reads), Lane B reversible in-workspace prep (compile/build/draft files — AUTHORIZED), Lane C sends/creates/deletes externally NEVER headless (draft + file only, ask in next chat)." : " Your instructions are the user's approval, so perform the sends/creates/deletes they request."}
- plus any custom MCP tools from Advanced → MCP Servers (if configured) — names vary, use exact declared schemas
Background tasks run headless: prefer web_search/web_fetch over interactive browser automation.
${skillsSection ? `\n${skillsSection}\n` : ""}${heartbeatContext}${heartbeatDiscipline}

## Workspace Organization
Use folders: documents/, presentations/, spreadsheets/, images/, code/ for outputs. Mark deliverables with [file: path].
If a folder or file is not where expected, check parent directories, workspace root, and user's home folder (~/, /tmp) via list_directory / list_external_directory before concluding missing.

## Execution discipline
- Emit tool calls directly — do not narrate "I will call..." without calling.
- Verify actions after tool calls.
- If a tool fails, fix args and retry at most ONCE with alternative strategy. Do NOT loop apologizing or retry same call >2 times.
- Never hallucinate tool outputs; only continue from real results.
- Report verified state (succeeded/partial/failed).
- Heartbeat: remain silent if nothing actionable; idempotent.

## Rules
- Do NOT ask questions. Work autonomously.
- MUST call tools to do work.
- Provide concise summary after tools.`;
}

// Active task runs tracking (Pi-owned)
const activeTaskRuns = new Map<string, AbortController>();

export async function executePiTask(
  task: ScheduledTask
): Promise<{ status: "success" | "error"; output: string; duration: number }> {
  const startTime = Date.now();
  const threadId = `pi_task_${task.id}`;
  const abortController = new AbortController();
  activeTaskRuns.set(threadId, abortController);

  const timeoutMs = parseInt(process.env.PI_TASK_TIMEOUT_MS || "180000", 10);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => abortController.abort(new Error(`Pi task timeout ${timeoutMs}ms`)), timeoutMs);
  }

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    activeTaskRuns.delete(threadId);
  };

  try {
    return await runPiTaskInternal(task, threadId, abortController.signal, startTime);
  } finally {
    cleanup();
  }
}

async function runPiTaskInternal(
  task: ScheduledTask,
  threadId: string,
  signal: AbortSignal,
  startTime: number
): Promise<{ status: "success" | "error"; output: string; duration: number }> {
  if (signal.aborted) throw new Error("Pi task aborted before start");

  const checkPermission = createTaskPermissionChecker(task.permissions);

  const wrap = (name: string, fn: (args: any) => Promise<string>) => {
    return async (...args: any[]) => {
      if (signal.aborted) return JSON.stringify({ error: true, tool: name, message: "Pi task cancelled" });
      const input = typeof args[0] === "object" && args[0] !== null ? args[0] : {};
      const { allowed, reason } = checkPermission(name, input);
      if (!allowed) return JSON.stringify({ error: true, tool: name, message: reason });
      try {
        return await fn(input);
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return JSON.stringify({ error: true, tool: name, message: msg });
      }
    };
  };

  // Use Pi tools as base, then extend with task-specific external tools (Pi unified ownership).
  // Scheduled tasks run unattended — no interactive questioning.
  const piBaseTools = createPiTools(threadId, { includeAskUser: false });

  // MCP: load custom servers for tasks as well (isolated, non-fatal)
  let mcpClients: Awaited<ReturnType<typeof loadMcpTools>>["clients"] = [];
  try {
    const mcpResult = await loadMcpTools({ threadId });
    if (Object.keys(mcpResult.tools).length > 0) {
      console.log(`[pi-task] Merging ${Object.keys(mcpResult.tools).length} MCP tools for task ${task.id}`);
      for (const [name, tool] of Object.entries(mcpResult.tools)) {
        (piBaseTools as any)[name] = tool;
      }
    }
    mcpClients = mcpResult.clients;
    if (mcpResult.errors.length > 0) {
      console.warn(`[pi-task] ${mcpResult.errors.length} MCP server(s) failed for task ${task.id}`);
    }
    signal.addEventListener?.("abort", () => { void closeMcpClients(mcpClients); }, { once: true });
  } catch (e) {
    console.warn("[pi-task] MCP load failed:", e);
  }

  // Agent tools (background-safe): schedule_task, update_heartbeat, ask_user (no user headless)
  try {
    const { createPiAgentTools } = await import("./agent-tools");
    const agentTools = createPiAgentTools({ threadId, background: true });
    for (const [name, t] of Object.entries(agentTools)) {
      (piBaseTools as any)[name] = t;
    }
  } catch (e) {
    console.warn("[pi-task] Agent tools load failed:", e);
  }

  // Headless plan (TodoWrite equivalent): in-memory snapshot that drives the
  // continuation loop below. Same contract as chat TodoWrite — COMPLETE list
  // each call, exactly one in_progress — but headless-only, never rendered.
  // The loop continues while items are unfinished (bounded rounds).
  // NOTE: non-nullable array — TS narrows `| null` to null across the tool
  // closure below, which breaks the continuation filter types.
  let headlessPlan: Array<{ content: string; status: string; activeForm?: string }> = [];
  try {
    const { tool } = await import("ai");
    const { z } = await import("zod");
    (piBaseTools as any).TodoWrite = tool({
      description:
        "Manage this background run's plan (headless). Pass the COMPLETE list each call. Call FIRST for work with 3+ steps, flip each item to completed the moment its sub-task finishes, exactly one in_progress at a time. Unfinished items earn another model round (bounded) — finished items end the run. Update immediately after each sub-task.",
      inputSchema: z.object({
        todos: z.array(z.object({
          content: z.string(),
          status: z.enum(["pending", "in_progress", "completed"]),
          activeForm: z.string().optional(),
        })).describe("The updated plan list. Replaces any previous list."),
      }),
      execute: async ({ todos }: { todos: Array<{ content: string; status: string; activeForm?: string }> }) => {
        if (!Array.isArray(todos)) return "Error: `todos` must be an array.";
        headlessPlan = todos;
        const done = todos.filter((t) => t.status === "completed").length;
        // Mirror into the durable goal store so chat can see background plans.
        try {
          const { mirrorHeadlessPlan } = await import("@/lib/goals/store");
          await mirrorHeadlessPlan(task.id, task.name, todos).catch(() => {});
        } catch {}
        return `Plan updated (${done}/${todos.length} completed). Continue working until every item is completed, then summarize.`;
      },
    });
  } catch (e) {
    console.warn("[pi-task] Headless plan tool failed:", e);
  }

  // Computer Use (background-safe): read-only tools work headless; mutating
  // computer_* tools refuse without an interactive user (see computer-tools gate).
  try {
    const { createComputerTools } = await import("./computer-tools");
    const { isComputerUseDisabled } = await import("./computer-use-mcp");
    if (!isComputerUseDisabled()) {
      const computerTools = createComputerTools(threadId, { includeAskUser: false });
      for (const [name, t] of Object.entries(computerTools)) {
        (piBaseTools as any)[name] = t;
      }
      console.log(`[pi-task] Merging ${Object.keys(computerTools).length} computer-use tools for task ${task.id}`);
    }
  } catch (e) {
    console.warn("[pi-task] Computer-use tools load failed:", e);
  }

  // Connectors: Composio tools for background runs (isolated, non-fatal).
  // Identity: no client here, so loadConnectorTools() resolves the
  // CANONICAL id — the same namespace the user connected accounts under
  // from chat (see resolveComposioUserId). Gating: only the autonomous
  // heartbeat monitor is forced draft-only; a user-created SCHEDULED task
  // carries explicit approval in its own instructions, so its tools run.
  // Draft stubs keep the REAL input schema (params intact) and block inside
  // execute — never z.object({}).passthrough(), which destroys the params
  // the model needs to draft properly.
  let connectorHint = "";
  try {
    const { loadConnectorTools } = await import("./connectors");
    const conn = await loadConnectorTools();
    if (Object.keys(conn.tools).length > 0) {
      console.log(`[pi-task] Merging ${Object.keys(conn.tools).length} connector tools for task ${task.id}`);
      let gated = 0;
      try {
        const { shouldGateConnectorTool } = await import("@/lib/permissions/sensitive");
        const { tool } = await import("ai");
        for (const [name, t] of Object.entries(conn.tools)) {
          if (shouldGateConnectorTool(task.type, name)) {
            gated++;
            const realSchema = (t as any)?.inputSchema ?? (t as any)?.parameters;
            (piBaseTools as any)[name] = tool({
              description: `HEADLESS DRAFT-ONLY for ${name}: the heartbeat monitor may only read — sends/creates/deletes cannot run without user approval. Fill the REAL parameters and return a draft instead (Lane B prep: save the draft content/file, then note it via update_heartbeat). Original: ${String((t as any)?.description || "").slice(0, 300)}`,
              inputSchema: realSchema,
              execute: async (args: any) =>
                JSON.stringify({
                  drafted: true,
                  tool: name,
                  args,
                  note: "Heartbeat monitor cannot send/create/delete without approval (Muse Sentinel rule). Draft saved — the user approves in chat.",
                }),
            });
          } else {
            (piBaseTools as any)[name] = t;
          }
        }
        if (gated > 0) console.log(`[pi-task] Gated ${gated} sensitive connector tools to draft-only for task ${task.id}`);
      } catch {
        for (const [name, t] of Object.entries(conn.tools)) {
          (piBaseTools as any)[name] = t;
        }
      }
    }
    if (conn.connected.length > 0) connectorHint = conn.connected.join(", ");
  } catch (e) {
    console.warn("[pi-task] Connector load failed:", e);
  }

  // Skills section for background prompt (progressive disclosure, capped)
  let skillsSection = "";
  try {
    const { skillStore } = await import("@/lib/skills/store");
    const { buildSkillsPromptSection } = await import("@/lib/skills/prompt");
    skillsSection = buildSkillsPromptSection(skillStore.getAll());
  } catch {}

  const baseTools: Record<string, any> = {
    ...piBaseTools,
    // Override/add task-specific variants that respect task permissions
    read_file: piBaseTools.read_file, // already permission-gated
    write_file: piBaseTools.write_file,
    edit_file: piBaseTools.edit_file,
    delete_file: piBaseTools.delete_file,
    list_directory: piBaseTools.list_directory,
    run_command: piBaseTools.run_command,
    web_search: piBaseTools.web_search,
    web_fetch: piBaseTools.web_fetch,

    list_external_directory: (() => {
      const { tool } = require("ai") as any;
      const { z } = require("zod") as any;
      return tool({
        description: "Lists files at an absolute path outside the workspace.",
        inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
        execute: wrap("list_external_directory", async ({ path }: { path: string }) => {
          try {
            const resolved = resolveExternalPath(path);
            const entries = await readdir(resolved, { withFileTypes: true });
            const items = await Promise.all(
              entries.map(async (entry) => {
                const fullPath = `${resolved}/${entry.name}`;
                let sz = 0;
                if (entry.isFile()) try { sz = (await stat(fullPath)).size; } catch {}
                return { name: entry.name, type: entry.isDirectory() ? "directory" : "file", size: sz, path: fullPath };
              })
            );
            return JSON.stringify({ path: resolved, items, totalItems: items.length });
          } catch (e) { return JSON.stringify({ error: (e as Error).message }); }
        }),
      });
    })(),

    read_external_file: (() => {
      const { tool } = require("ai") as any;
      const { z } = require("zod") as any;
      return tool({
        description: "Reads a file at an absolute path outside the workspace.",
        inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
        execute: wrap("read_external_file", async ({ path }: { path: string }) => {
          try {
            const resolved = resolveExternalPath(path);
            const content = await readFile(resolved, "utf-8");
            const lines = content.split("\n");
            const s = await stat(resolved);
            return JSON.stringify({ path: resolved, size: s.size, lineCount: lines.length, extension: extname(resolved), content });
          } catch (e) { return JSON.stringify({ error: (e as Error).message }); }
        }),
      });
    })(),

    read_memory: (() => {
      const { tool } = require("ai") as any;
      const { z } = require("zod") as any;
      return tool({
        description: "Reads persistent memory across sessions.",
        inputSchema: z.object({ label: z.string().optional() }),
        execute: async () => JSON.stringify({ entries: await getMemoryEntries() }),
      });
    })(),
  };

  let heartbeatStateText = "";
  if (task.type === "heartbeat") {
    try {
      const { loadHeartbeatState } = await import("@/lib/scheduler/heartbeat-state");
      const hbState = await loadHeartbeatState();
      heartbeatStateText = `Last heartbeat: ${hbState.lastHeartbeat ? new Date(hbState.lastHeartbeat).toISOString() : "never"}\nLast successful: ${hbState.lastSuccessfulCheck ? new Date(hbState.lastSuccessfulCheck).toISOString() : "never"}\nPending actions: ${hbState.pendingActions.map((a: any) => a.description).join(" | ") || "none"}\nFailed: ${hbState.failedActions.map((f: any) => `${f.description} (retry ${new Date(f.retryAt).toISOString()})`).join(" | ") || "none"}\nConsecutive empty ticks: ${hbState.consecutiveEmptyTicks}`;
    } catch {}
  }

  try {
    const bg = resolveBackgroundModelId();
    if (!bg.modelId) {
      return { status: "error", output: "No AI provider configured. Add one in Settings -> Advanced.", duration: 0 };
    }
    if (bg.fallback) {
      console.warn(
        `[pi-task] Default model "${bg.requested}" needs a user session (ChatGPT subscription) which background tasks don't have — ` +
          `using "${bg.modelId}" for ${task.type} "${task.id}" instead. Set a non-ChatGPT default in Settings → Model for headless runs.`
      );
    } else if (isChatGPTModel(bg.modelId)) {
      // No non-ChatGPT alternative configured — fail with an actionable message
      // instead of the raw "requires request context" throw.
      const msg =
        `Background ${task.type} "${task.name}" is set to ChatGPT model "${bg.modelId}" which needs your signed-in session and cannot run headless. ` +
        `In Settings → Model pick a non-ChatGPT default (e.g. Ollama local or another provider) for heartbeat/scheduled tasks, ` +
        `or keep ChatGPT for chat only.`;
      console.warn(`[pi-task] ${msg}`);
      const { appendLog } = await import("@/lib/scheduler/task-log");
      const duration = Date.now() - startTime;
      await appendLog({
        timestamp: startTime,
        taskId: task.id,
        name: task.name,
        status: "error",
        output: msg.slice(0, 500),
        duration,
      });
      return { status: "error" as const, output: msg, duration };
    }
    if (signal.aborted) throw new Error("Pi task aborted before model call");

    const { streamText } = await import("ai");
    const maxSteps = task.type === "heartbeat"
      ? parseInt(process.env.PI_TASK_HEARTBEAT_STEPS || "12", 10)
      : parseInt(process.env.PI_TASK_SCHEDULED_STEPS || "20", 10);
    const maxRounds = parseInt(process.env.PI_TASK_MAX_ROUNDS || "3", 10);
    const system = buildPiTaskSystemPrompt(task, heartbeatStateText, skillsSection || undefined, connectorHint || undefined);

    // Multi-round loop: run, then continue while the headless plan has
    // unfinished items (bounded). Each round's prompt carries prior progress
    // + remaining items so work continues without re-discovering context.
    let combinedOutput = "";
    let totalToolCount = 0;
    let totalSteps = 0;
    let round = 0;
    for (;;) {
      if (signal.aborted) throw new Error("Pi task aborted before model call");
      const roundPrompt = round === 0
        ? `Execute task: ${task.name}\nInstructions: ${task.instructions}`
        : `Continue task: ${task.name}\nOriginal instructions: ${task.instructions}\n\nPrior progress (round ${round}):\n${combinedOutput.slice(-2000)}\n\nUnfinished plan:\n${headlessPlan.filter((t) => t.status !== "completed").map((t, i) => `${i + 1}. ${t.content} (${t.status})`).join("\n")}\n\nKeep working NOW with tools — update TodoWrite the moment each item completes, verify, and summarize only when every item is completed.`;
      const result = streamText({
        model: createPiModelClient(bg.modelId),
        system,
        prompt: roundPrompt,
        maxRetries: 0,
        abortSignal: signal,
        temperature: task.type === "heartbeat" ? 0.2 : 0.3,
        tools: baseTools,
        stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= maxSteps,
      });

      const output = await result.text;
      const steps = await result.steps;
      const toolCount = (steps as any[]).reduce((sum: number, s: any) => sum + (s.toolCalls?.length ?? 0), 0);
      totalToolCount += toolCount;
      totalSteps += (steps as any[]).length;
      combinedOutput = combinedOutput ? `${combinedOutput}\n\n${output}` : output;

      const unfinished = headlessPlan.filter((t) => t.status !== "completed");
      if (unfinished.length > 0 && round + 1 < maxRounds && !signal.aborted) {
        round++;
        console.log(`[pi-task] Task ${task.id} continuation round ${round}/${maxRounds - 1} — ${unfinished.length} plan item(s) unfinished`);
        continue;
      }
      if (unfinished.length > 0) {
        console.warn(`[pi-task] Task ${task.id} plan budget exhausted — ${unfinished.length} item(s) still unfinished`);
      }
      break;
    }
    const output = combinedOutput;
    const toolCount = totalToolCount;
    const duration = Date.now() - startTime;

    console.log(`[pi-task] Task ${task.id} completed via Pi: tools=${toolCount}, steps=${totalSteps}, rounds=${round + 1}, output=${(output || "(no output)").slice(0, 100)}`);

    const { appendLog } = await import("@/lib/scheduler/task-log");
    // Wire generated-file scan: verify [file:] markers actually exist.
    let generatedNote = "";
    try {
      const generated = await scanGeneratedFiles();
      if (generated.length > 0) {
        generatedNote = ` files=[${generated.slice(0, 5).map((g) => g.relativePath).join(", ")}]`;
      }
    } catch {}
    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "success",
      output: `[pi tools=${toolCount} rounds=${round + 1}${generatedNote}] ${(output || "(no output)").slice(0, 480)}`,
      duration,
    });

    // Sync headless plan completion into the durable goal store.
    try {
      const { syncHeadlessPlanDone } = await import("@/lib/goals/store");
      await syncHeadlessPlanDone(task.id).catch(() => {});
    } catch {}

    return { status: "success" as const, output: output || "(no output)", duration };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const isAbort = error?.name === "AbortError" || signal.aborted || /aborted|cancelled/i.test(error?.message || "");
    const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    console.error(`[pi-task] Task ${task.id} failed${isAbort ? " (aborted)" : ""}: ${errMsg}`);

    const { appendLog } = await import("@/lib/scheduler/task-log");
    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "error",
      output: isAbort ? `Cancelled: ${errMsg.slice(0, 500)}` : errMsg.slice(0, 500),
      duration,
    });

    return { status: "error" as const, output: errMsg, duration };
  } finally {
    // Snapshot browser tabs before MCP teardown closes them (see harness).
    try {
      const { snapshotBrowserTabs } = await import("@/lib/browser/tabs");
      await snapshotBrowserTabs();
    } catch {}
    try {
      await closeMcpClients(mcpClients);
    } catch {}
  }
}

export function cancelPiTask(taskId: string): boolean {
  const tid = `pi_task_${taskId}`;
  const ctrl = activeTaskRuns.get(tid);
  if (!ctrl) return false;
  ctrl.abort(new Error("Pi task cancelled"));
  return true;
}

export function isPiTaskActive(taskId: string): boolean {
  return activeTaskRuns.has(`pi_task_${taskId}`);
}

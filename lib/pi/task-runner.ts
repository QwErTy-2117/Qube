/**
 * Pi task runner — non-streaming execution for scheduler/background tasks.
 * Uses Pi harness primitives (providerStore, modelClient, tools) but returns
 * final output string instead of streaming to UI writer.
 * Lifecycle owned by Pi (concurrency guard, timeout, cancellation, cleanup).
 */

import { providerStore } from "./provider-store";
import { createPiModelClient } from "./model-client";
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
      ? `\n\n## Heartbeat discipline (OpenClaw-style — narrow and quiet)
- This is a flexible periodic inspection, NOT an exact-timed automation. Follow the pending checklist when provided; do the smallest useful check.
- Recurring work belongs in scheduled tasks — do NOT create schedules from here and do NOT infer old tasks from prior chats.
- If nothing needs attention, return exactly HEARTBEAT_OK with no tool calls (quiet tick, idempotent).
- Check pending/failed actions first, act once, never repeat a completed action. Never send destructive messages without an explicit user-approved schedule.`
      : `\n\n## Scheduled-task discipline (exact timing, isolated)
- This is an exact-timed automation with its own run history. Execute the instructions fully and autonomously.
- Verify every action after tool calls; report verified state (succeeded/partial/failed). Never claim work without tool results.`;
  return `You are Qube Pi background task "${task.name}" (${task.type}). You run via Pi harness without user supervision. ${formatCurrentTimeInstruction()}

## Your Task
${task.instructions}

## Available Tools
- Files: write_file, read_file, edit_file, delete_file, list_directory, list_external_directory, read_external_file, present_file
- Shell: run_command (respects task permissions: runCommands=${task.permissions.runCommands}, destructive=${task.permissions.destructiveCommands})
- Web: web_search, web_fetch (allowed=${task.permissions.webAccess})
- Memory: read_memory (persistent memory across sessions)
- Goals: TodoWrite is NOT available headless — track progress in your final summary instead.
- Subagents: subagent(description, prompt, agentType) — isolated child (Explore/researcher/reviewer/general). Use for recon that would flood context; validate outputs.
- Automations: schedule_task (create/list/update/delete/trigger), update_heartbeat (get/note/update) — manage future work from background runs.
- ask_user always returns available=false headless — never block on it; proceed with best judgment.
- Connectors${connectorHint ? ` (connected: ${connectorHint})` : ""}: external service tools via Composio when connected (exact schemas at runtime). Destructive sends need confirmation which cannot complete headless — draft instead of sending.
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

  // Connectors: Composio tools for background runs (default user, isolated, non-fatal)
  let connectorHint = "";
  try {
    const { loadConnectorTools } = await import("./connectors");
    const conn = await loadConnectorTools();
    if (Object.keys(conn.tools).length > 0) {
      console.log(`[pi-task] Merging ${Object.keys(conn.tools).length} connector tools for task ${task.id}`);
      for (const [name, t] of Object.entries(conn.tools)) {
        (piBaseTools as any)[name] = t;
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
    const defaultModelId = providerStore.getDefaultModelId();
    if (!defaultModelId) {
      return { status: "error", output: "No AI provider configured. Add one in Settings -> Advanced.", duration: 0 };
    }
    if (signal.aborted) throw new Error("Pi task aborted before model call");

    const { streamText } = await import("ai");
    const maxSteps = task.type === "heartbeat" ? 8 : 12;

    const result = streamText({
      model: createPiModelClient(defaultModelId),
      system: buildPiTaskSystemPrompt(task, heartbeatStateText, skillsSection || undefined, connectorHint || undefined),
      prompt: `Execute task: ${task.name}\nInstructions: ${task.instructions}`,
      maxRetries: 0,
      abortSignal: signal,
      temperature: task.type === "heartbeat" ? 0.2 : 0.3,
      tools: baseTools,
      stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= maxSteps,
    });

    const output = await result.text;
    const steps = await result.steps;
    const toolCount = (steps as any[]).reduce((sum: number, s: any) => sum + (s.toolCalls?.length ?? 0), 0);
    const duration = Date.now() - startTime;

    console.log(`[pi-task] Task ${task.id} completed via Pi: tools=${toolCount}, steps=${(steps as any[]).length}, output=${(output || "(no output)").slice(0, 100)}`);

    const { appendLog } = await import("@/lib/scheduler/task-log");
    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "success",
      output: `[pi tools=${toolCount}] ${(output || "(no output)").slice(0, 480)}`,
      duration,
    });

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

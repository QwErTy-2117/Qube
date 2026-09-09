/**
 * Pi agent tools — conversational management of schedules, heartbeat, and user questions.
 * These let the main agent (and background tasks where safe) work with the
 * full system: scheduled tasks, heartbeat state, and ask-user — alongside
 * files, shell, web, subagents, goals (TodoWrite), connectors, MCP, and skills.
 *
 * OpenClaw discipline applied:
 * - Recurring work belongs in scheduled tasks (automations), not in heartbeat scratch.
 * - Heartbeat stays narrow and quiet: HEARTBEAT_OK when nothing needs attention.
 * - schedule_task / update_heartbeat calls are idempotent and validated.
 */

import { tool } from "ai";
import { z } from "zod";

export type AgentToolsContext = {
  threadId: string;
  /** Background/scheduler runs have no interactive user. */
  background?: boolean;
};

export function createPiAgentTools(ctx: AgentToolsContext): Record<string, any> {
  const { threadId, background } = ctx;

  const schedule_task = tool({
    description:
      "Manage scheduled automations (OpenClaw-style cron). Use for exact-timing work: daily reports, reminders, weekly reviews, one-shot follow-ups. " +
      "Actions: create (name, instructions, scheduleKind interval|once, intervalMinutes|runAt ISO, permissions), list, get, update, delete, trigger (run now). " +
      "Recurring checks belong here — NOT in heartbeat scratch. Returns JSON.",
    inputSchema: z.object({
      action: z.enum(["create", "list", "get", "update", "delete", "trigger"]).describe("Action to perform"),
      id: z.string().optional().describe("Task id for get/update/delete/trigger"),
      name: z.string().optional().describe("Task name for create/update"),
      instructions: z.string().optional().describe("What the agent should do when the task runs"),
      scheduleKind: z.enum(["interval", "once"]).optional().describe("interval=recurring, once=one-shot"),
      intervalMinutes: z.number().optional().describe("Recurring interval in minutes"),
      runAt: z.string().optional().describe("ISO date for once tasks"),
      enabled: z.boolean().optional().describe("Enable/disable (update only)"),
    }),
    execute: async (args: any) => {
      try {
        const store = await import("@/lib/scheduler/task-store");
        switch (args.action) {
          case "list": {
            const tasks = await store.getTasks();
            return JSON.stringify({
              tasks: tasks.map((t: any) => ({
                id: t.id,
                type: t.type,
                name: t.name,
                enabled: t.enabled,
                schedule: t.schedule,
                lastRunAt: t.lastRunAt,
                nextRunAt: t.nextRunAt,
              })),
            });
          }
          case "get": {
            if (!args.id) return JSON.stringify({ error: "id is required for get" });
            const t = await store.getTask(args.id);
            if (!t) return JSON.stringify({ error: "Task not found" });
            return JSON.stringify({ task: t });
          }
          case "create": {
            if (!args.name || !args.instructions || !args.scheduleKind)
              return JSON.stringify({ error: "name, instructions, scheduleKind are required for create" });
            const task = await store.createTask({
              name: args.name,
              instructions: args.instructions,
              scheduleKind: args.scheduleKind,
              intervalMinutes: args.intervalMinutes,
              runAt: args.runAt ? new Date(args.runAt).getTime() : undefined,
            });
            return JSON.stringify({ message: `Scheduled task "${task.name}" created.`, task });
          }
          case "update": {
            if (!args.id) return JSON.stringify({ error: "id is required for update" });
            const patch: any = {};
            if (args.name !== undefined) patch.name = args.name;
            if (args.instructions !== undefined) patch.instructions = args.instructions;
            if (args.scheduleKind !== undefined) {
              patch.schedule = {
                kind: args.scheduleKind,
                intervalMinutes: args.intervalMinutes,
                runAt: args.runAt ? new Date(args.runAt).getTime() : undefined,
              };
            }
            if (args.enabled !== undefined) patch.enabled = args.enabled;
            const t = await store.updateTask(args.id, patch);
            if (!t) return JSON.stringify({ error: "Task not found" });
            return JSON.stringify({ message: `Task "${t.name}" updated.`, task: t });
          }
          case "delete": {
            if (!args.id) return JSON.stringify({ error: "id is required for delete" });
            const ok = await store.deleteTask(args.id);
            if (!ok) return JSON.stringify({ error: "Task not found or heartbeat cannot be deleted" });
            return JSON.stringify({ message: "Task deleted." });
          }
          case "trigger": {
            if (!args.id) return JSON.stringify({ error: "id is required for trigger" });
            const t = await store.getTask(args.id);
            if (!t) return JSON.stringify({ error: "Task not found" });
            const { executeTask } = await import("@/lib/scheduler/task-executor");
            const result = await executeTask(t);
            try {
              await store.updateTaskRunTime(t.id, result.status === "success");
            } catch {}
            return JSON.stringify({
              message: `Task "${t.name}" triggered: ${result.status}.`,
              output: result.output.slice(0, 2000),
            });
          }
          default:
            return JSON.stringify({ error: `Unknown action: ${args.action}` });
        }
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const update_heartbeat = tool({
    description:
      "Inspect or update the heartbeat monitor (OpenClaw-style flexible checks). Heartbeat = lightweight periodic inspection, quiet when nothing to do. " +
      "Actions: get (state + config), update (instructions, intervalMinutes, enabled), note (add a pending checklist item for the next tick). " +
      "Do NOT put recurring schedules in heartbeat scratch — use schedule_task instead. If nothing needs attention, heartbeat replies HEARTBEAT_OK.",
    inputSchema: z.object({
      action: z.enum(["get", "update", "note"]).describe("get=inspect, update=config, note=add pending checklist item"),
      instructions: z.string().optional().describe("New heartbeat instructions (update only)"),
      intervalMinutes: z.number().optional().describe("New heartbeat interval in minutes (update only)"),
      enabled: z.boolean().optional().describe("Enable/disable heartbeat (update only)"),
      note: z.string().optional().describe("Pending checklist note for next tick (note only)"),
    }),
    execute: async (args: any) => {
      try {
        const store = await import("@/lib/scheduler/task-store");
        const hb = await import("@/lib/scheduler/heartbeat-state");
        if (args.action === "get") {
          const task = await store.getTask("heartbeat");
          const state = await hb.loadHeartbeatState();
          return JSON.stringify({
            task: task
              ? { name: task.name, enabled: task.enabled, schedule: task.schedule, lastRunAt: task.lastRunAt, nextRunAt: task.nextRunAt, instructions: task.instructions }
              : null,
            state: {
              lastHeartbeat: state.lastHeartbeat,
              lastSuccessfulCheck: state.lastSuccessfulCheck,
              consecutiveEmptyTicks: state.consecutiveEmptyTicks,
              totalTicks: state.totalTicks,
              pendingActions: state.pendingActions,
              failedActions: state.failedActions.slice(-5),
            },
          });
        }
        if (args.action === "note") {
          if (!args.note) return JSON.stringify({ error: "note text is required" });
          await hb.addPendingAction(args.note);
          return JSON.stringify({ message: "Heartbeat note added for next tick." });
        }
        // update
        const patch: any = {};
        if (args.instructions !== undefined) patch.instructions = args.instructions;
        if (args.intervalMinutes !== undefined)
          patch.schedule = { kind: "interval", intervalMinutes: args.intervalMinutes };
        if (args.enabled !== undefined) patch.enabled = args.enabled;
        if (Object.keys(patch).length === 0)
          return JSON.stringify({ error: "Provide instructions, intervalMinutes, or enabled to update" });
        const t = await store.updateTask("heartbeat", patch);
        if (!t) return JSON.stringify({ error: "Heartbeat task not found" });
        return JSON.stringify({ message: "Heartbeat updated.", task: { enabled: t.enabled, schedule: t.schedule } });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const ask_user = tool({
    description:
      "Ask the user a clarifying question (multiple choice or free text). Use when blocked on a decision only the user can make. " +
      "In background/scheduled runs there is no user — the call returns immediately with available=false, so never block on it there.",
    inputSchema: z.object({
      question: z.string().describe("The question to ask"),
      options: z.array(z.string()).optional().describe("Clickable options (omit for free-text)"),
    }),
    execute: async ({ question, options }: { question: string; options?: string[] }) => {
      if (background) {
        return JSON.stringify({
          available: false,
          message: "No interactive user in background runs. Proceed autonomously with best judgment.",
        });
      }
      try {
        const { normalizeQuestions, createQuestionnaire } = await import(
          "@/lib/agent/tools/ask-user-tool"
        );
        const normalized = normalizeQuestions([{ id: "answer", question, options }]);
        if ("error" in normalized) {
          return JSON.stringify({ available: true, error: normalized.error });
        }
        const { promise, requestId } = createQuestionnaire(threadId, normalized);
        console.log(`[ask-user] Question ${requestId} for thread ${threadId}: ${question.slice(0, 120)}`);
        const timeoutMs = parseInt(process.env.ASK_USER_TIMEOUT_MS || "300000", 10);
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const answers = await Promise.race([promise, timeout]);
        if (answers === null) {
          return JSON.stringify({ available: true, timedOut: true, message: "User did not answer in time. Proceed with best judgment." });
        }
        const first = Object.values(answers)[0];
        const answer = Array.isArray(first) ? first.join(", ") : String(first ?? "");
        return JSON.stringify({ available: true, answer });
      } catch (e: any) {
        return JSON.stringify({ available: false, error: e?.message || String(e) });
      }
    },
  });

  void threadId;
  return { schedule_task, update_heartbeat, ask_user };
}

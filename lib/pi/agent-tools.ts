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

/**
 * Scheduling-cue gate (audit fix #1): a schedule_task create requires an
 * explicit recurring/future cue from the user. One-shot immediate lookups
 * ("check the price of X", "what does X cost") must run inline instead.
 * Pure — unit-tested in tests/agent-proactivity.test.ts.
 */
export function hasSchedulingCue(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /every|daily|weekly|monthly|remind|keep an eye|tell me when|monitor|watch|each |once |at \d|tomorrow|next week|follow.?up|report/.test(t);
}

export function createPiAgentTools(ctx: AgentToolsContext): Record<string, any> {
  const { threadId, background } = ctx;

  const schedule_task = tool({
    description:
      "Manage scheduled automations (OpenClaw-style cron). Use ONLY for exact-timing work with an explicit recurring/one-shot-future cue from the user: daily reports, reminders, weekly reviews, one-shot follow-ups at a future time. " +
      "ONE-SHOT READS ARE NOT SCHEDULES: 'check the price of X', 'what does X cost', 'look up…' with no every/keep-an-eye/tell-me-when/monitor cue must be done INLINE now with web_search/web_fetch — never create a task for them. " +
      "Actions: create (name, instructions, scheduleKind interval|once, intervalMinutes|runAt ISO, doneCriteria, condition/onlyReportIf, deliverablePath, hour/minute/weekdays/monthDay, permissions), list, get, update, delete, trigger (run now). " +
      "Recurring checks belong here — NOT in heartbeat scratch. Scheduled work runs inside Qube, so it only runs while Qube is open and running — tell the user that when you create one. Returns JSON.",
    inputSchema: z.object({
      action: z.enum(["create", "list", "get", "update", "delete", "trigger"]).describe("Action to perform"),
      id: z.string().optional().describe("Task id for get/update/delete/trigger"),
      name: z.string().optional().describe("Task name for create/update"),
      instructions: z.string().optional().describe("What the agent should do when the task runs"),
      scheduleKind: z.enum(["interval", "once"]).optional().describe("interval=recurring, once=one-shot future run"),
      intervalMinutes: z.number().optional().describe("Recurring interval in minutes"),
      runAt: z.string().optional().describe("ISO date for once tasks"),
      enabled: z.boolean().optional().describe("Enable/disable (update only)"),
      doneCriteria: z.string().optional().describe("Checkable success criteria for each run (e.g. 'report only if price < €800 with source link; else stay silent')"),
      condition: z.string().optional().describe("Only-report-if rule / threshold (e.g. 'only report if price changed >2%')"),
      deliverablePath: z.string().optional().describe("Workspace path for file deliverables (e.g. documents/price-watch.md)"),
      hour: z.number().optional().describe("Daily wall-clock hour 0-23 (interval tasks)"),
      minute: z.number().optional().describe("Daily wall-clock minute 0-59 (interval tasks)"),
      weekdays: z.array(z.number()).optional().describe("Weekdays 0=Sun..6=Sat for weekly patterns"),
      monthDay: z.number().optional().describe("Day of month 1-31 for monthly patterns"),
      permissions: z.object({
        runCommands: z.boolean().optional(),
        destructiveCommands: z.boolean().optional(),
        externalFiles: z.boolean().optional(),
        webAccess: z.boolean().optional(),
      }).optional().describe("Least-privilege flags for the background run"),
    }),
    execute: async (args: any) => {
      try {
        const store = await import("@/lib/scheduler/task-store");
        // Gate: create requires an explicit recurring/future cue in the
        // instructions. One-shot immediate reads must run inline instead.
        if (args.action === "create") {
          const text = `${args.name || ""} ${args.instructions || ""} ${args.doneCriteria || ""} ${args.condition || ""}`;
          const isFutureOnce = args.scheduleKind === "once" && !!args.runAt;
          if (!hasSchedulingCue(text) && !isFutureOnce) {
            return JSON.stringify({
              error: "Not a schedule: this looks like a one-shot lookup. Do it inline now with web_search/web_fetch instead of creating a task. Only create a task when the user gave an explicit recurring cue (every…, remind me…, keep an eye…, tell me when…, monitor…) or a future runAt.",
            });
          }
        }
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
            const extras: string[] = [];
            if (args.doneCriteria) extras.push(`Done criteria: ${args.doneCriteria}`);
            if (args.condition) extras.push(`Only-report-if: ${args.condition}`);
            if (args.deliverablePath) extras.push(`Deliverable: ${args.deliverablePath}`);
            const instructions = extras.length > 0
              ? `${args.instructions}\n\n${extras.join("\n")}`
              : args.instructions;
            const task = await store.createTask({
              name: args.name,
              instructions,
              scheduleKind: args.scheduleKind,
              intervalMinutes: args.intervalMinutes,
              runAt: args.runAt ? new Date(args.runAt).getTime() : undefined,
              hour: args.hour,
              minute: args.minute,
              weekdays: args.weekdays,
              monthDay: args.monthDay,
              permissions: args.permissions,
            });
            return JSON.stringify({ message: `Scheduled task "${task.name}" created. It runs inside Qube, so it only runs while Qube is open and running.`, task });
          }
          case "update": {
            if (!args.id) return JSON.stringify({ error: "id is required for update" });
            const patch: any = {};
            if (args.name !== undefined) patch.name = args.name;
            if (args.instructions !== undefined || args.doneCriteria !== undefined || args.condition !== undefined || args.deliverablePath !== undefined) {
              const cur = await store.getTask(args.id);
              const base = args.instructions !== undefined ? args.instructions : (cur?.instructions || "");
              const extras: string[] = [];
              if (args.doneCriteria) extras.push(`Done criteria: ${args.doneCriteria}`);
              if (args.condition) extras.push(`Only-report-if: ${args.condition}`);
              if (args.deliverablePath) extras.push(`Deliverable: ${args.deliverablePath}`);
              patch.instructions = extras.length > 0 ? `${base}\n\n${extras.join("\n")}` : base;
            }
            if (args.scheduleKind !== undefined) {
              patch.schedule = {
                kind: args.scheduleKind,
                intervalMinutes: args.intervalMinutes,
                runAt: args.runAt ? new Date(args.runAt).getTime() : undefined,
                hour: args.hour,
                minute: args.minute,
                weekdays: args.weekdays,
                monthDay: args.monthDay,
              };
            } else if (args.hour !== undefined || args.minute !== undefined || args.weekdays !== undefined || args.monthDay !== undefined) {
              const cur = await store.getTask(args.id);
              patch.schedule = {
                ...(cur?.schedule || { kind: "interval" }),
                ...(args.hour !== undefined ? { hour: args.hour } : {}),
                ...(args.minute !== undefined ? { minute: args.minute } : {}),
                ...(args.weekdays !== undefined ? { weekdays: args.weekdays } : {}),
                ...(args.monthDay !== undefined ? { monthDay: args.monthDay } : {}),
              };
            }
            if (args.permissions !== undefined) patch.permissions = { ...(await store.getTask(args.id))?.permissions, ...args.permissions };
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
      "Inspect or update the heartbeat monitor (Muse-style: workspace + connector watch, quiet when nothing new). Heartbeat = lightweight periodic inspection that saves findings for the NEXT chat. " +
      "Actions: get (state + config), update (instructions, intervalMinutes, enabled), note (save ONE finding for the next chat — deduped, never repeats twice). " +
      "Note lanes: Lane A monitor finding (evidence + draft reply/action) OR Lane B prep result (reversible in-workspace work you already did: compiled file, built table — include fileRefs + what to ask the user next chat). Lane C sends/posts/deletes NEVER run headless — draft + file only. " +
      "Do NOT put recurring schedules in heartbeat scratch — use schedule_task instead. If nothing needs attention, heartbeat replies HEARTBEAT_OK.",
    inputSchema: z.object({
      action: z.enum(["get", "update", "note"]).describe("get=inspect, update=config, note=save a finding for next chat"),
      instructions: z.string().optional().describe("New heartbeat instructions (update only)"),
      intervalMinutes: z.number().optional().describe("New heartbeat interval in minutes (update only)"),
      enabled: z.boolean().optional().describe("Enable/disable heartbeat (update only)"),
      note: z.string().optional().describe("Finding for next chat: 'Topic — evidence + draft' (note only, e.g. 'Party emails — 3 Gmail threads from Ana/Ben about Saturday + draft reply')"),
      topic: z.string().optional().describe("Structured topic (note only; preferred over parsing note)"),
      evidence: z.string().optional().describe("Evidence for the finding (note only)"),
      draft: z.string().optional().describe("Draft reply/action prepared (note only)"),
      fileRefs: z.array(z.string()).optional().describe("Workspace file paths produced by Lane B prep (note only)"),
      deadline: z.string().optional().describe("Deadline if any (note only)"),
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
          const composed = args.note || [args.topic, args.evidence, args.draft, args.deadline].filter(Boolean).join(" — ");
          if (!composed) return JSON.stringify({ error: "note text (or topic/evidence/draft) is required" });
          // Engine gate: score before storing so duplicates / rejected /
          // fatigued topics are suppressed with a reason (audit fix #4).
          try {
            const { decideHeartbeatFinding } = await import("@/lib/proactivity/heartbeat-decide");
            const verdict = await decideHeartbeatFinding({
              topic: String(args.topic || composed).split("—")[0].split("-")[0].trim().slice(0, 200),
              detail: composed.slice(0, 500),
              evidence: [args.evidence, args.draft].filter(Boolean).map(String).concat(["heartbeat monitor"]),
            });
            if (!verdict.proceed || verdict.duplicate) {
              return JSON.stringify({ message: `Suppressed (${verdict.decision}): ${verdict.reasons.join("; ").slice(0, 300)}`, duplicate: true, decision: verdict.decision });
            }
          } catch {}
          const res = await hb.addPendingAction(composed, undefined, args.fileRefs);
          if ((res as any)?.duplicate) {
            return JSON.stringify({ message: "Duplicate — already pending or recently notified. Skipped (never repeats twice).", duplicate: true });
          }
          // Mirror into proactive suggestions so the next chat surfaces it
          // once with evidence, then suppresses repeats.
          try {
            const { recordHeartbeatFinding } = await import("@/lib/proactivity/heartbeat-brief");
            const topic = String(args.topic || composed).split("—")[0].split("-")[0].trim().slice(0, 120) || "Heartbeat finding";
            await recordHeartbeatFinding({ topic, detail: composed.slice(0, 500), evidence: [args.evidence, args.draft].filter(Boolean).map(String).concat(["heartbeat monitor"]) });
          } catch {}
          // Mirror Lane B prep into the durable goal store so chat resumes it.
          try {
            if (Array.isArray(args.fileRefs) && args.fileRefs.length > 0) {
              const { upsertGoal } = await import("@/lib/goals/store");
              await upsertGoal({
                topic: String(args.topic || composed).split("—")[0].slice(0, 200),
                lane: "prep",
                evidence: composed.slice(0, 500),
                fileRefs: args.fileRefs.map(String).slice(0, 8),
                source: "heartbeat-note",
              }).catch(() => {});
            }
          } catch {}
          return JSON.stringify({ message: "Heartbeat finding saved for next chat (will surface once)." });
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

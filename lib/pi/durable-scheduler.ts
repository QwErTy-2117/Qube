import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { hasSchedulingCue } from "@/lib/pi/agent-tools";

function textOut(payload: unknown) {
  return { output: [{ type: "text", text: JSON.stringify(payload) }] as Array<{ type: "text"; text: string }> };
}

export const scheduleTaskTool = defineTool({
  name: "schedule_task",
  description:
    "Manage scheduled automations. Use ONLY for exact-timing work with an explicit recurring/one-shot-future cue: daily reports, reminders, weekly reviews, one-shot follow-ups. " +
    "One-shot reads ('check the price of X') must run INLINE with web_search/web_fetch — never create a task for them. " +
    "Actions: create (name, instructions, scheduleKind interval|once, ...), list, get, update, delete, trigger (run now). " +
    "Scheduled work runs inside Qube, so it only runs while Qube is open and running. (Never auto-replayed after a crash.)",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("create"), Type.Literal("list"), Type.Literal("get"),
      Type.Literal("update"), Type.Literal("delete"), Type.Literal("trigger"),
    ]),
    id: Type.Optional(Type.String({ description: "Task id for get/update/delete/trigger" })),
    name: Type.Optional(Type.String()),
    instructions: Type.Optional(Type.String()),
    scheduleKind: Type.Optional(Type.Union([Type.Literal("interval"), Type.Literal("once")])),
    intervalMinutes: Type.Optional(Type.Number()),
    runAt: Type.Optional(Type.String({ description: "ISO date for once tasks" })),
    enabled: Type.Optional(Type.Boolean()),
    doneCriteria: Type.Optional(Type.String()),
    condition: Type.Optional(Type.String()),
    deliverablePath: Type.Optional(Type.String()),
    hour: Type.Optional(Type.Number()),
    minute: Type.Optional(Type.Number()),
    weekdays: Type.Optional(Type.Array(Type.Number())),
    monthDay: Type.Optional(Type.Number()),
    permissions: Type.Optional(Type.Object({
      runCommands: Type.Optional(Type.Boolean()),
      destructiveCommands: Type.Optional(Type.Boolean()),
      externalFiles: Type.Optional(Type.Boolean()),
      webAccess: Type.Optional(Type.Boolean()),
    })),
  }),
  execute: async (args) => {
    try {
      const store = await import("@/lib/scheduler/task-store");
      if (args.action === "create") {
        const text = `${args.name || ""} ${args.instructions || ""} ${args.doneCriteria || ""} ${args.condition || ""}`;
        const isFutureOnce = args.scheduleKind === "once" && !!args.runAt;
        if (!hasSchedulingCue(text) && !isFutureOnce) {
          return textOut({
            error: "Not a schedule: this looks like a one-shot lookup. Do it inline now with web_search/web_fetch instead of creating a task. Only create a task with an explicit recurring cue or a future runAt.",
          });
        }
      }
      switch (args.action) {
        case "list": {
          const tasks = await store.getTasks();
          return textOut({
            tasks: tasks.map((t) => ({
              id: t.id, type: t.type, name: t.name, enabled: t.enabled,
              schedule: t.schedule, lastRunAt: t.lastRunAt, nextRunAt: t.nextRunAt,
            })),
          });
        }
        case "get": {
          if (!args.id) return textOut({ error: "id is required for get" });
          const t = await store.getTask(args.id);
          if (!t) return textOut({ error: "Task not found" });
          return textOut({ task: t });
        }
        case "create": {
          if (!args.name || !args.instructions || !args.scheduleKind) {
            return textOut({ error: "name, instructions, scheduleKind are required for create" });
          }
          const extras: string[] = [];
          if (args.doneCriteria) extras.push(`Done criteria: ${args.doneCriteria}`);
          if (args.condition) extras.push(`Only-report-if: ${args.condition}`);
          if (args.deliverablePath) extras.push(`Deliverable: ${args.deliverablePath}`);
          const instructions = extras.length > 0 ? `${args.instructions}\n\n${extras.join("\n")}` : args.instructions;
          const task = await store.createTask({
            name: args.name,
            instructions,
            scheduleKind: args.scheduleKind,
            intervalMinutes: args.intervalMinutes,
            runAt: args.runAt ? new Date(args.runAt).getTime() : undefined,
            hour: args.hour,
            minute: args.minute,
            weekdays: args.weekdays as number[] | undefined,
            monthDay: args.monthDay,
            permissions: args.permissions,
          });
          return textOut({ message: `Scheduled task "${task.name}" created. It runs inside Qube, so it only runs while Qube is open and running.`, task });
        }
        case "update": {
          if (!args.id) return textOut({ error: "id is required for update" });
          const patch: Record<string, unknown> = {};
          if (args.name !== undefined) patch.name = args.name;
          if (args.instructions !== undefined || args.doneCriteria !== undefined || args.condition !== undefined || args.deliverablePath !== undefined) {
            const cur = await store.getTask(args.id);
            const base = args.instructions !== undefined ? args.instructions : cur?.instructions || "";
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
          if (args.permissions !== undefined) {
            patch.permissions = { ...(await store.getTask(args.id))?.permissions, ...args.permissions };
          }
          if (args.enabled !== undefined) patch.enabled = args.enabled;
          const t = await store.updateTask(args.id, patch as never);
          if (!t) return textOut({ error: "Task not found" });
          return textOut({ message: `Task "${t.name}" updated.`, task: t });
        }
        case "delete": {
          if (!args.id) return textOut({ error: "id is required for delete" });
          const ok = await store.deleteTask(args.id);
          if (!ok) return textOut({ error: "Task not found or heartbeat cannot be deleted" });
          return textOut({ message: "Task deleted." });
        }
        case "trigger": {
          if (!args.id) return textOut({ error: "id is required for trigger" });
          const t = await store.getTask(args.id);
          if (!t) return textOut({ error: "Task not found" });
          const { executeTask } = await import("@/lib/scheduler/task-executor");
          const result = await executeTask(t);
          try {
            await store.updateTaskRunTime(t.id, result.status === "success");
          } catch {}
          return textOut({ message: `Task "${t.name}" triggered: ${result.status}.`, output: result.output.slice(0, 2000) });
        }
        default:
          return textOut({ error: `Unknown action: ${args.action}` });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return textOut({ error: msg });
    }
  },
});

export const updateHeartbeatTool = defineTool({
  name: "update_heartbeat",
  description:
    "Inspect or update the heartbeat monitor (quiet periodic inspection that saves findings for the NEXT chat). " +
    "Actions: get (state + config), update (instructions/interval/enabled), note (save ONE finding for next chat — deduped, never repeats twice). " +
    "Lane C sends/posts/deletes NEVER run headless — draft + file only. Recurring work belongs in schedule_task, not heartbeat scratch.",
  parameters: Type.Object({
    action: Type.Union([Type.Literal("get"), Type.Literal("update"), Type.Literal("note")]),
    instructions: Type.Optional(Type.String()),
    intervalMinutes: Type.Optional(Type.Number()),
    enabled: Type.Optional(Type.Boolean()),
    note: Type.Optional(Type.String()),
    topic: Type.Optional(Type.String()),
    evidence: Type.Optional(Type.String()),
    draft: Type.Optional(Type.String()),
    fileRefs: Type.Optional(Type.Array(Type.String())),
    deadline: Type.Optional(Type.String()),
  }),
  execute: async (args) => {
    try {
      const store = await import("@/lib/scheduler/task-store");
      const hb = await import("@/lib/scheduler/heartbeat-state");
      if (args.action === "get") {
        const task = await store.getTask("heartbeat");
        const state = await hb.loadHeartbeatState();
        return textOut({
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
        if (!composed) return textOut({ error: "note text (or topic/evidence/draft) is required" });
        try {
          const { decideHeartbeatFinding } = await import("@/lib/proactivity/heartbeat-decide");
          const verdict = await decideHeartbeatFinding({
            topic: String(args.topic || composed).split("—")[0].split("-")[0].trim().slice(0, 200),
            detail: composed.slice(0, 500),
            evidence: [args.evidence, args.draft].filter(Boolean).map(String).concat(["heartbeat monitor"]),
          });
          if (!verdict.proceed || verdict.duplicate) {
            return textOut({ message: `Suppressed (${verdict.decision}): ${verdict.reasons.join("; ").slice(0, 300)}`, duplicate: true, decision: verdict.decision });
          }
        } catch {}
        const res = await hb.addPendingAction(composed, undefined, args.fileRefs as string[] | undefined);
        if ((res as { duplicate?: boolean })?.duplicate) {
          return textOut({ message: "Duplicate — already pending or recently notified. Skipped (never repeats twice).", duplicate: true });
        }
        try {
          const { recordHeartbeatFinding } = await import("@/lib/proactivity/heartbeat-brief");
          const topic = String(args.topic || composed).split("—")[0].split("-")[0].trim().slice(0, 120) || "Heartbeat finding";
          await recordHeartbeatFinding({ topic, detail: composed.slice(0, 500), evidence: [args.evidence, args.draft].filter(Boolean).map(String).concat(["heartbeat monitor"]) });
        } catch {}
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
        return textOut({ message: "Heartbeat finding saved for next chat (will surface once)." });
      }
      const patch: Record<string, unknown> = {};
      if (args.instructions !== undefined) patch.instructions = args.instructions;
      if (args.intervalMinutes !== undefined) patch.schedule = { kind: "interval", intervalMinutes: args.intervalMinutes };
      if (args.enabled !== undefined) patch.enabled = args.enabled;
      if (Object.keys(patch).length === 0) {
        return textOut({ error: "Provide instructions, intervalMinutes, or enabled to update" });
      }
      const t = await store.updateTask("heartbeat", patch as never);
      if (!t) return textOut({ error: "Heartbeat task not found" });
      return textOut({ message: "Heartbeat updated.", task: { enabled: t.enabled, schedule: t.schedule } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return textOut({ error: msg });
    }
  },
});

export function buildSchedulerExtension() {
  return defineExtension({ name: "scheduler", tools: [scheduleTaskTool, updateHeartbeatTool] });
}

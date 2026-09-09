"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CheckCircle2, Circle, AlertTriangle, XCircle, PauseCircle, ListChecks, Plus, StickyNote } from "lucide-react";

function safeParse(s: unknown): any {
  if (typeof s === "string") try { return JSON.parse(s); } catch { return null; }
  return s;
}

const statusIcon: Record<string, any> = {
  completed: CheckCircle2,
  pending: Circle,
  active: Circle,
  failed: XCircle,
  blocked: PauseCircle,
  skipped: XCircle,
};

const statusColor: Record<string, string> = {
  completed: "text-green-600",
  pending: "text-muted-foreground",
  active: "text-blue-600",
  failed: "text-destructive",
  blocked: "text-orange-600",
  skipped: "text-muted-foreground/60",
};

export const GoalToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const a = (args || {}) as any;
  const r = safeParse(result);
  const action = a.action || "list";

  if (action === "list" && r?.goals) {
    const goals = r.goals as any[];
    if (goals.length === 0) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <ListChecks className="size-4" />
          No goals yet
        </div>
      );
    }
    return (
      <div className="rounded-lg border p-2.5 text-sm">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <ListChecks className="size-4 text-primary" />
          Goals — {r.summary || `${goals.length} items`}
        </div>
        <div className="space-y-1.5">
          {goals.map((g: any) => {
            const Icon = statusIcon[g.status] || Circle;
            const color = statusColor[g.status] || "text-muted-foreground";
            return (
              <div key={g.id} className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5">
                <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium leading-tight ${g.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{g.title}</div>
                  {g.verificationCriteria && <div className="text-[10px] text-muted-foreground">verify: {g.verificationCriteria}</div>}
                  {g.blockedReason && <div className="text-[10px] text-orange-600">blocked: {g.blockedReason}</div>}
                  {g.failureReason && <div className="text-[10px] text-destructive">failed: {g.failureReason}</div>}
                </div>
                <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-mono ${g.status === "completed" ? "bg-green-100 text-green-700" : g.status === "blocked" ? "bg-orange-100 text-orange-700" : g.status === "failed" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>{g.status}</span>
              </div>
            );
          })}
        </div>
        {r.formatted && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Raw checklist</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap font-mono">{r.formatted}</pre>
          </details>
        )}
      </div>
    );
  }

  const titleMap: Record<string, string> = {
    create: `Goal: ${a.title || ""}`,
    add_subgoal: `Sub-goal: ${a.title || ""}`,
    complete: "Goal completed",
    fail: "Goal failed",
    block: "Goal blocked",
    reopen: "Goal reopened",
    remove: "Goal removed",
    update: "Goal updated",
    reorder: "Goal reordered",
    add_note: "Note added",
    add_constraint: "Constraint added",
  };
  const title = titleMap[action] || `Goals: ${action}`;
  const Icon = action === "create" || action === "add_subgoal" ? Plus : action === "add_note" || action === "add_constraint" ? StickyNote : action === "complete" ? CheckCircle2 : action === "block" ? PauseCircle : action === "fail" ? XCircle : ListChecks;
  const isError = r?.error;

  return (
    <div className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
      {isError ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Icon className="mt-0.5 size-4 shrink-0 text-primary" />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {a.verificationCriteria && <div className="text-xs text-muted-foreground">verify: {a.verificationCriteria}</div>}
        {a.reason && <div className="text-xs text-muted-foreground">{a.reason}</div>}
        {a.note && <div className="text-xs text-muted-foreground">"{a.note}"</div>}
        {isError && <div className="mt-1 text-xs text-destructive">{r.error}</div>}
        {r?.goal && <div className="mt-1 text-xs text-muted-foreground">→ {r.goal.title} [{r.goal.status}]</div>}
        {r?.all && <div className="mt-1 text-xs text-muted-foreground">{r.all}</div>}
      </div>
    </div>
  );
};

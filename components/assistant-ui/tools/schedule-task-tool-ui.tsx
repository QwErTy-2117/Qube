"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Clock, Plus, Play, Trash2, Edit3, ListChecks, AlertCircle } from "lucide-react";

function safeParse(s: unknown): any {
  if (typeof s === "string") try { return JSON.parse(s); } catch { return null; }
  return s;
}

export const ScheduleTaskToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const a = (args || {}) as any;
  const r = safeParse(result);
  const isError = r?.error;

  const iconMap: Record<string, typeof Clock> = {
    create: Plus,
    edit: Edit3,
    delete: Trash2,
    list: ListChecks,
    trigger: Play,
  };
  const Icon = iconMap[a.action] || Clock;

  const title =
    a.action === "create"
      ? `Scheduled: ${a.name}`
      : a.action === "trigger"
        ? `Triggered: ${a.name || a.task_id}`
        : a.action === "delete"
          ? "Task Deleted"
          : a.action === "edit"
            ? "Task Updated"
            : a.action === "list"
              ? "Scheduled Tasks"
              : `Task ${a.action}`;

  const description =
    a.action === "create" && a.schedule_kind === "interval"
      ? `Every ${a.interval_minutes || 30} minutes`
      : a.action === "create" && a.schedule_kind === "once"
        ? "Runs once"
        : a.action === "list" && r?.tasks
          ? `${r.tasks.length} task${r.tasks.length !== 1 ? "s" : ""}`
          : "";

  return (
    <div className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
      {isError ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
        {isError && (
          <div className="text-xs text-destructive mt-1">{r.error}</div>
        )}
        {r?.message && !isError && (
          <div className="text-xs text-muted-foreground mt-1">{r.message}</div>
        )}
      </div>
    </div>
  );
};

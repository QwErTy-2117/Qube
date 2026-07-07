"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Heart,
  Clock,
  Plus,
  Play,
  Trash2,
  Edit3,
  Loader2,
  CheckIcon,
  XIcon,
  AlertCircle,
  FileText,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface ScheduledTask {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: "interval" | "once";
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  permissions: {
    runCommands: boolean;
    destructiveCommands: boolean;
    externalFiles: boolean;
    webAccess: boolean;
    browserAccess: boolean;
  };
  lastRunAt: number | null;
  nextRunAt: number;
}

interface LogEntry {
  timestamp: number;
  taskId: string;
  name: string;
  status: "success" | "error";
  output: string;
  duration: number;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 shrink-0 border-b border-border/60 mb-4">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {action}
    </div>
  );
}

type PermissionKey = keyof ScheduledTask["permissions"];

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  runCommands: "Run commands",
  destructiveCommands: "Destructive commands",
  externalFiles: "Access external files",
  webAccess: "Web search & fetch",
  browserAccess: "Browser automation",
};

function TaskForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<ScheduledTask>;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [instructions, setInstructions] = useState(initial?.instructions || "");
  const [scheduleKind, setScheduleKind] = useState<"interval" | "once">(initial?.schedule?.kind || "interval");
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.schedule?.intervalMinutes || 30);
  const [runAt, setRunAt] = useState(
    initial?.schedule?.runAt
      ? new Date(initial.schedule.runAt).toISOString().slice(0, 16)
      : ""
  );
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>(
    initial?.permissions || {
      runCommands: false,
      destructiveCommands: false,
      externalFiles: false,
      webAccess: false,
      browserAccess: false,
    }
  );

  const handleSave = () => {
    onSave({
      name,
      instructions,
      scheduleKind,
      intervalMinutes: scheduleKind === "interval" ? intervalMinutes : undefined,
      runAt: scheduleKind === "once" ? runAt : undefined,
      permissions,
    });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground">Task Name</label>
        <input
          type="text"
          placeholder="My Scheduled Task"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground">Instructions</label>
        <textarea
          placeholder="What should the agent do when this task runs?"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground">Schedule</label>
        <div className="flex gap-2">
          <button
            onClick={() => setScheduleKind("interval")}
            className={cn(
              "flex-1 px-3 py-2 rounded-lg border text-sm transition-all",
              scheduleKind === "interval"
                ? "border-primary/60 bg-primary/5"
                : "border-border hover:bg-muted/40"
            )}
          >
            Every N minutes
          </button>
          <button
            onClick={() => setScheduleKind("once")}
            className={cn(
              "flex-1 px-3 py-2 rounded-lg border text-sm transition-all",
              scheduleKind === "once"
                ? "border-primary/60 bg-primary/5"
                : "border-border hover:bg-muted/40"
            )}
          >
            Run once
          </button>
        </div>
        {scheduleKind === "interval" ? (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <input
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 30)}
              className="w-20 px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-center outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
        ) : (
          <input
            type="datetime-local"
            value={runAt}
            onChange={(e) => setRunAt(e.target.value)}
            className="w-full px-3 py-2 mt-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground">Permissions</label>
        <p className="text-[10px] text-muted-foreground -mt-1">
          What the task is allowed to do. Keep locked down unless needed.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setPermissions((p) => ({ ...p, [key]: !p[key] }))}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all text-left",
                permissions[key]
                  ? "border-primary/40 bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/40"
              )}
            >
              {permissions[key] ? (
                <ToggleRight className="size-3.5 text-primary shrink-0" />
              ) : (
                <ToggleLeft className="size-3.5 shrink-0" />
              )}
              {PERMISSION_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <XIcon className="size-3.5 mr-1" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave}>
          <CheckIcon className="size-3.5 mr-1" />
          {initial ? "Update" : "Create"} Task
        </Button>
      </div>
    </div>
  );
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [heartbeat, setHeartbeat] = useState<ScheduledTask | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [savingHeartbeat, setSavingHeartbeat] = useState(false);
  const [heartbeatInstructions, setHeartbeatInstructions] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, heartbeatRes, logRes] = await Promise.all([
        fetch("/api/scheduler/tasks"),
        fetch("/api/scheduler/heartbeat"),
        fetch("/api/scheduler/log"),
      ]);
      const tasksData = await tasksRes.json();
      const heartbeatData = await heartbeatRes.json();
      const logData = await logRes.json();
      setTasks(tasksData.tasks || []);
      setHeartbeat(heartbeatData.task || null);
      setHeartbeatInstructions(heartbeatData.task?.instructions || "");
      setLog(logData.entries || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveHeartbeat = async () => {
    setSavingHeartbeat(true);
    try {
      const res = await fetch("/api/scheduler/heartbeat", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: heartbeatInstructions }),
      });
      const data = await res.json();
      if (data.task) setHeartbeat(data.task);
    } finally { setSavingHeartbeat(false); }
  };

  const handleCreateTask = async (data: any) => {
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", ...data }),
      });
      const result = await res.json();
      if (result.task) {
        setTasks((prev) => [...prev, result.task]);
        setShowCreateForm(false);
      }
    } catch {}
  };

  const handleUpdateTask = async (id: string, data: any) => {
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, ...data }),
      });
      const result = await res.json();
      if (result.task) {
        setTasks((prev) => prev.map((t) => (t.id === id ? result.task : t)));
        setEditingTaskId(null);
      }
    } catch {}
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch {}
  };

  const handleTriggerTask = async (id: string) => {
    try {
      await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", id }),
      });
    } catch {}
  };

  const handleToggleTask = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, enabled }),
      });
      const result = await res.json();
      if (result.task) {
        setTasks((prev) => prev.map((t) => (t.id === id ? result.task : t)));
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const scheduledTasks = tasks.filter((t) => t.type === "scheduled");

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.2 }}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto space-y-6 pr-1">
        {/* Heartbeat Section */}
        <div>
          <SectionHeader
            title="Heartbeat"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveHeartbeat}
                disabled={savingHeartbeat}
                className="h-7 text-xs"
              >
                {savingHeartbeat ? (
                  <Loader2 className="size-3 animate-spin mr-1" />
                ) : (
                  <CheckIcon className="size-3 mr-1" />
                )}
                Save
              </Button>
            }
          />
          {heartbeat && (
            <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Heart className="size-4 text-rose-500" />
                  <span className="text-sm font-semibold">Heartbeat</span>
                  <span className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                    heartbeat.enabled
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {heartbeat.enabled ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Every {heartbeat.schedule.intervalMinutes || 30}m</span>
                  <span>Next: {formatDate(heartbeat.nextRunAt)}</span>
                  <span>Last: {formatDate(heartbeat.lastRunAt)}</span>
                </div>
              </div>
              <textarea
                value={heartbeatInstructions}
                onChange={(e) => setHeartbeatInstructions(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Scheduled Tasks Section */}
        <div>
          <SectionHeader
            title="Scheduled Tasks"
            action={
              !showCreateForm && (
                <Button
                  size="sm"
                  onClick={() => setShowCreateForm(true)}
                  className="h-7 text-xs"
                >
                  <Plus className="size-3 mr-1" />
                  Create Task
                </Button>
              )
            }
          />

          {showCreateForm && (
            <div className="mb-4">
              <TaskForm onSave={handleCreateTask} onCancel={() => setShowCreateForm(false)} />
            </div>
          )}

          {editingTaskId && (
            <div className="mb-4">
              <TaskForm
                initial={tasks.find((t) => t.id === editingTaskId)}
                onSave={(data) => handleUpdateTask(editingTaskId, data)}
                onCancel={() => setEditingTaskId(null)}
              />
            </div>
          )}

          {scheduledTasks.length === 0 && !showCreateForm ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-border/60 bg-muted/10">
              <Clock className="size-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-semibold text-foreground/70">No scheduled tasks</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-[240px]">
                Create a task to run the agent on a schedule — daily reports, health checks, file cleanup.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {scheduledTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{task.name}</span>
                      <span className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                        task.enabled
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {task.enabled ? "Active" : "Paused"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.instructions}</p>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60 mt-1.5">
                      <span>
                        {task.schedule.kind === "interval"
                          ? `Every ${task.schedule.intervalMinutes || 30} min`
                          : `Once on ${formatDate(task.schedule.runAt || null)}`}
                      </span>
                      <span>Next: {formatDate(task.nextRunAt)}</span>
                      <span>Last: {formatDate(task.lastRunAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleTask(task.id, !task.enabled)}
                      className="size-7 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground/60 hover:text-foreground"
                      title={task.enabled ? "Pause" : "Activate"}
                    >
                      {task.enabled ? <ToggleRight className="size-3.5" /> : <ToggleLeft className="size-3.5" />}
                    </button>
                    <button
                      onClick={() => handleTriggerTask(task.id)}
                      className="size-7 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground/60 hover:text-foreground"
                      title="Run now"
                    >
                      <Play className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingTaskId(task.id)}
                      className="size-7 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground/60 hover:text-foreground"
                      title="Edit"
                    >
                      <Edit3 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="size-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground/60 hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Execution Log Section */}
        <div>
          <button
            onClick={() => setLogExpanded(!logExpanded)}
            className="w-full flex items-center justify-between pb-3 border-b border-border/60 mb-4"
          >
            <h3 className="text-base font-semibold tracking-tight">Execution Log</h3>
            {logExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>

          {logExpanded && (
            <div className="rounded-xl border border-border/60 bg-muted/10">
              {log.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="size-6 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground/60">No executions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50 max-h-[300px] overflow-y-auto">
                  {log.map((entry, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                      <div className={cn(
                        "size-2 rounded-full mt-1.5 shrink-0",
                        entry.status === "success" ? "bg-emerald-500" : "bg-red-500"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{entry.name}</span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {formatDate(entry.timestamp)}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {entry.duration}ms
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                          {entry.output}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EchoRing } from "@/components/assistant-ui/echo-ring";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Check,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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

function cleanLogOutput(output: string): string {
  return (output || "").replace(/^\s*\[pi tools=\d+\]\s*/i, "").trim();
}

function stripMarkdownInline(s: string): string {
  let out = s;
  // links [text](url) → text
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // bold/italic/strike/code
  out = out.replace(/(\*\*|__)(.*?)\1/g, "$2");
  out = out.replace(/(\*|_|~~|`)(.*?)\1/g, "$2");
  out = out.replace(/`([^`]+)`/g, "$1");
  // headings, quotes, list markers, hr
  out = out.replace(/^#{1,6}\s+/g, "");
  out = out.replace(/^>\s?/g, "");
  out = out.replace(/^[-*+]\s+/g, "");
  out = out.replace(/^\d+[.)]\s+/g, "");
  out = out.replace(/^[-*_]{3,}\s*$/g, "");
  return out.replace(/\s+/g, " ").trim();
}

function logOneLiner(output: string): string {
  const cleaned = cleanLogOutput(output);
  const line =
    cleaned
      .split("\n")
      .map((s) => stripMarkdownInline(s.trim()))
      .find((s) => s.length > 0 && !/^HEARTBEAT_OK$/i.test(s)) || "";
  if (!line) return "No output";
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}

function LogMarkdown({ text }: { text: string }) {
  const clean = cleanLogOutput(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ className, ...props }: any) => (
          <p className={cn("mb-3 leading-relaxed last:mb-0", className)} {...props} />
        ),
        strong: ({ className, ...props }: any) => (
          <strong className={cn("font-semibold text-foreground", className)} {...props} />
        ),
        em: ({ className, ...props }: any) => (
          <em className={cn("italic", className)} {...props} />
        ),
        ul: ({ className, ...props }: any) => (
          <ul className={cn("mb-3 list-disc space-y-1 pl-5 last:mb-0", className)} {...props} />
        ),
        ol: ({ className, ...props }: any) => (
          <ol className={cn("mb-3 list-decimal space-y-1 pl-5 last:mb-0", className)} {...props} />
        ),
        li: ({ className, ...props }: any) => (
          <li className={cn("leading-relaxed", className)} {...props} />
        ),
        code: ({ className, children, ...props }: any) => {
          const str = String(children ?? "");
          const isBlock = str.includes("\n");
          if (isBlock) {
            return (
              <pre className="mb-3 overflow-x-auto rounded-lg bg-background/60 p-3 font-mono text-xs last:mb-0">
                <code {...props}>{children}</code>
              </pre>
            );
          }
          return (
            <code className={cn("rounded bg-background/60 px-1 py-0.5 font-mono text-xs", className)} {...props}>
              {children}
            </code>
          );
        },
        a: ({ className, ...props }: any) => (
          <a className={cn("text-primary underline underline-offset-2", className)} {...props} />
        ),
      }}
    >
      {clean}
    </ReactMarkdown>
  );
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, logRes] = await Promise.all([
        fetch("/api/scheduler/tasks"),
        fetch("/api/scheduler/log"),
      ]);
      const tasksData = await tasksRes.json();
      const logData = await logRes.json();
      setTasks(tasksData.tasks || []);
      setLog(logData.entries || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function isDone(task: ScheduledTask): boolean {
    return task.schedule.kind === "once" && task.lastRunAt != null;
  }

  const scheduledTasks = tasks.filter((t) => t.type === "scheduled");
  const recurringTasks = scheduledTasks.filter((t) => t.schedule.kind === "interval");
  const onceTasks = scheduledTasks.filter((t) => t.schedule.kind === "once");

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.2 }}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1 scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {/* Recurring — top, no circles */}
        <div className="shrink-0">
          <div className="flex items-center gap-2 pb-1 mb-3">
            <h3 className="text-base font-semibold tracking-tight">Recurring</h3>
            {recurringTasks.length > 0 && (
              <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded-full">
                {recurringTasks.length}
              </span>
            )}
          </div>
          {recurringTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-border/60 bg-muted/10">
              <p className="text-sm text-muted-foreground/60">No recurring tasks</p>
            </div>
          ) : (
            <div className="space-y-2 pr-1">
              {recurringTasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/60 bg-muted/10">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold">{task.name}</span>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.instructions}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 mt-1.5">
                      <span>
                        {task.schedule.intervalMinutes === 1440 ? "Every day" : task.schedule.intervalMinutes === 10080 ? "Every week" : task.schedule.intervalMinutes === 43200 ? "Every month" : `Every ${task.schedule.intervalMinutes || 1440} min`}
                      </span>
                      <span>Next: {formatDate(task.nextRunAt)}</span>
                      <span>Last: {formatDate(task.lastRunAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Once tasks — middle, left status circle indicator-only */}
        <div className="shrink-0">
          <div className="flex items-center gap-2 pb-1 mb-3">
            <h3 className="text-base font-semibold tracking-tight">Tasks</h3>
            {onceTasks.length > 0 && (
              <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded-full">
                {onceTasks.length}
              </span>
            )}
          </div>
          {onceTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-border/60 bg-muted/10">
              <p className="text-sm text-muted-foreground/60">No tasks</p>
            </div>
          ) : (
            <div className="space-y-2 pr-1">
              {onceTasks.map((task) => {
                const done = isDone(task);
                return (
                  <div key={task.id} className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/60 bg-muted/10">
                    <span aria-hidden="true" className="shrink-0 pt-0.5">
                      {done ? (
                        <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <Check className="size-3" />
                        </span>
                      ) : (
                        <span className="block size-5 rounded-full border-2 border-border" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold">{task.name}</span>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.instructions}</p>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 mt-1.5">
                        <span>Once on {formatDate(task.schedule.runAt || null)}</span>
                        {done ? <span>Ran: {formatDate(task.lastRunAt)}</span> : <span>Next: {formatDate(task.nextRunAt)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Execution Log — bottom of flow, always last */}
        <div className="shrink-0">
          <div className="flex items-center justify-between pb-1 mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">Execution Log</h3>
              {log.length > 0 && (
                <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded-full">
                  {log.length}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLog(true)}
              className="h-8 text-xs rounded-full"
            >
              <FileText className="size-3.5 mr-1" />
              View Log
            </Button>
          </div>

          {/* Log Dialog — skill-catalog style cards, one-line summaries */}
          <Dialog open={showLog} onOpenChange={setShowLog}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col rounded-3xl">
              <DialogHeader>
                <DialogTitle>Execution Log</DialogTitle>
                <DialogDescription>
                  Recent task execution history.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden min-h-0">
                {log.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="size-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground/60">No executions yet</p>
                  </div>
                ) : (
                  <div className="space-y-2 py-1">
                    {log.map((entry, i) => (
                      <button
                        key={`${entry.taskId}-${entry.timestamp}-${i}`}
                        type="button"
                        onClick={() => setSelectedLog(entry)}
                        className="flex w-full items-center gap-3 rounded-xl border border-border bg-muted/10 p-3 text-left transition-colors hover:bg-muted/20 cursor-pointer"
                      >
                        <span className="flex shrink-0 items-center">
                          <EchoRing tone={entry.status === "success" ? "done" : "error"} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {entry.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {logOneLiner(entry.output)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Log detail popup — subagent-style */}
          <Dialog open={selectedLog !== null} onOpenChange={(v) => { if (!v) setSelectedLog(null); }}>
            <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl border border-border bg-background p-0 shadow-2xl sm:max-w-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-background px-5 py-3">
                <DialogTitle className="flex min-w-0 items-center gap-3 text-sm font-semibold">
                  <span className="flex shrink-0 items-center">
                    <EchoRing tone={selectedLog?.status === "success" ? "done" : "error"} size={18} />
                  </span>
                  <span className="flex min-w-0 items-baseline gap-3 truncate">
                    <span className="shrink-0">{selectedLog?.name}</span>
                    <span className="truncate font-normal text-muted-foreground">
                      {selectedLog ? formatDate(selectedLog.timestamp) : ""}
                    </span>
                  </span>
                </DialogTitle>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto bg-background px-5 py-4">
                {selectedLog && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span
                        className={cn(
                          "font-medium",
                          selectedLog.status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {selectedLog.status === "success" ? "Succeeded" : "Failed"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{(selectedLog.duration / 1000).toFixed(1)}s</span>
                    </div>
                    <div className="rounded-xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
                      <LogMarkdown text={selectedLog.output || "No output"} />
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-border/40 bg-background px-5 py-3">
                <div className="rounded-2xl bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
                  Execution details are read-only.{" "}
                  <button
                    type="button"
                    onClick={() => setSelectedLog(null)}
                    className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                  >
                    Back to log.
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </motion.div>
  );
}

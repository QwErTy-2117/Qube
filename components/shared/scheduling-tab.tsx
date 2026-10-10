"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  Column,
  gentleSpring,
  type ColumnData,
  type ColumnStatus,
  type DragState,
} from "@/components/ui/kanban-board";

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
  lastRunAt: number | null;
  nextRunAt: number;
}

function isDone(task: ScheduledTask): boolean {
  return task.schedule.kind === "once" && task.lastRunAt != null;
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragState, setDragState] = useState<DragState>(null);
  // Ids of tasks currently executing (triggered via the board).
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const runningRef = useRef<Set<string>>(new Set());
  // Delete-zone highlight while a dragged card hovers it.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Create-task dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");
  const [createKind, setCreateKind] = useState<"once" | "interval">("once");
  const [createRunAt, setCreateRunAt] = useState("");
  const [createInterval, setCreateInterval] = useState(1440);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduler/tasks", { cache: "no-store" });
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {}
  }, []);

  useEffect(() => {
    // Placements are state-driven now — drop the old manual-position store.
    try {
      localStorage.removeItem("qube-tasks-board");
    } catch {}
    (async () => {
      await fetchTasks();
      setLoading(false);
    })();
  }, [fetchTasks]);

  // Every scheduled task lives on the board — pending interval (recurring)
  // tasks as well as one-shots. Only ran one-shots count as Done.
  const boardTasks = useMemo(
    () => tasks.filter((t) => t.type === "scheduled"),
    [tasks]
  );

  // Columns always match task state: done when ran, in progress while the
  // execution triggered from the board is running, to do otherwise.
  const columns: ColumnData[] = useMemo(() => {
    const buckets: Record<ColumnStatus, ScheduledTask[]> = {
      todo: [],
      "in-progress": [],
      done: [],
    };
    for (const task of boardTasks) {
      if (isDone(task)) {
        buckets.done.push(task);
      } else if (runningIds.includes(task.id)) {
        buckets["in-progress"].push(task);
      } else {
        buckets.todo.push(task);
      }
    }
    // Newest completion first, so a just-finished task is always visible
    // at the top and the oldest is the one that falls off past the cap.
    buckets.done.sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0));
    return [
      {
        id: "todo",
        title: "To do",
        status: "todo",
        cards: buckets.todo.map((t) => ({ id: t.id, title: t.name, done: false })),
      },
      {
        id: "in-progress",
        title: "In progress",
        status: "in-progress",
        cards: buckets["in-progress"].map((t) => ({ id: t.id, title: t.name, done: false })),
      },
      {
        id: "done",
        title: "Done",
        status: "done",
        cards: buckets.done.map((t) => ({ id: t.id, title: t.name, done: true })),
      },
    ];
  }, [boardTasks, runningIds]);

  // Dropping a card into In progress triggers the task for real. Anything
  // else is a no-op — placement always derives from task state.
  const triggerTask = useCallback(
    async (id: string) => {
      if (runningRef.current.has(id)) return;
      const task = boardTasks.find((t) => t.id === id);
      if (!task || isDone(task)) return;
      runningRef.current.add(id);
      setRunningIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      try {
        await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger", id }),
        });
      } catch {}
      runningRef.current.delete(id);
      setRunningIds((prev) => prev.filter((rid) => rid !== id));
      fetchTasks();
    },
    [boardTasks, fetchTasks]
  );

  // A Done card that slid out (past the cap of 5) is deleted for good —
  // removed locally at once, deleted server-side in the background.
  const handleCardGone = useCallback((cardId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== cardId));
    fetch("/api/scheduler/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: cardId }),
    }).catch(() => {});
  }, []);

  const handleDrop = useCallback(
    (cardId: string, fromColumnId: ColumnStatus, toColumnId: ColumnStatus) => {
      if (fromColumnId === toColumnId) return;
      // Done is locked: no manual moves into or out of it.
      if (fromColumnId === "done" || toColumnId === "done") return;
      if (toColumnId === "in-progress" && fromColumnId === "todo") {
        triggerTask(cardId);
      }
    },
    [triggerTask]
  );

  function resetCreateForm() {
    setCreateName("");
    setCreateInstructions("");
    setCreateKind("once");
    setCreateRunAt("");
    setCreateInterval(1440);
    setCreateError(null);
  }

  const canCreate =
    createName.trim().length > 0 &&
    createInstructions.trim().length > 0 &&
    (createKind === "interval" ||
      (createRunAt !== "" && new Date(createRunAt).getTime() > Date.now()));

  async function handleCreate() {
    if (!canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> =
        createKind === "once"
          ? {
              action: "create",
              name: createName.trim(),
              instructions: createInstructions.trim(),
              scheduleKind: "once",
              runAt: new Date(createRunAt).toISOString(),
            }
          : {
              action: "create",
              name: createName.trim(),
              instructions: createInstructions.trim(),
              scheduleKind: "interval",
              intervalMinutes: createInterval,
            };
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.task) {
        throw new Error(data?.error || "Failed to create task.");
      }
      setCreateOpen(false);
      resetCreateForm();
      fetchTasks();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <MotionConfig transition={gentleSpring}>
      <motion.div
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.2 }}
        className="flex min-h-[500px] w-full flex-1 items-start justify-center px-6 py-8 antialiased"
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div className="w-full space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold tracking-tight">Tasks</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
              className="h-8 text-xs rounded-full"
            >
              <Plus className="size-3.5 mr-1" />
              New task
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-5">
            {columns.map((col) => (
              <Column
                column={col}
                dragState={dragState}
                key={col.id}
                onCardGone={handleCardGone}
                onDrop={handleDrop}
                setDragState={setDragState}
              />
            ))}
          </div>
          {/* Delete zone — slides up from the bottom while dragging a card */}
          <AnimatePresence initial={false}>
            {dragState && (
              <motion.div
                key="delete-zone"
                initial={{ opacity: 0, height: 0, y: 16 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: 16 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="overflow-hidden"
              >
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (deleteTimeout.current) clearTimeout(deleteTimeout.current);
                    setDeleteArmed(true);
                  }}
                  onDragLeave={() => {
                    deleteTimeout.current = setTimeout(() => setDeleteArmed(false), 60);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDeleteArmed(false);
                    const cardId =
                      dragState?.cardId || e.dataTransfer.getData("text/plain");
                    if (cardId) handleCardGone(cardId);
                    setDragState(null);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-sm font-medium transition-colors",
                    deleteArmed
                      ? "border-red-500 bg-red-500/20 text-red-600 dark:text-red-400"
                      : "border-red-500/40 bg-red-500/10 text-red-600/80 dark:text-red-400/80"
                  )}
                >
                  <Trash2 className="size-4" />
                  Drop here to delete
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Create task dialog */}
        <Dialog
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) resetCreateForm();
          }}
        >
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle>New task</DialogTitle>
              <DialogDescription>
                One-off tasks run once and land in Done. Recurring tasks stay
                in To do and run on repeat.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Name</label>
                <input
                  type="text"
                  placeholder="What needs doing?"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  Instructions
                </label>
                <textarea
                  placeholder="What should the agent do?"
                  value={createInstructions}
                  onChange={(e) => setCreateInstructions(e.target.value)}
                  rows={3}
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Run</label>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/30 p-1">
                  {(["once", "interval"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setCreateKind(kind)}
                      className={cn(
                        "rounded-lg py-1.5 text-xs font-semibold transition-colors",
                        createKind === kind
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {kind === "once" ? "Once" : "Recurring"}
                    </button>
                  ))}
                </div>
              </div>

              {createKind === "once" ? (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    Run at
                  </label>
                  <input
                    type="datetime-local"
                    value={createRunAt}
                    onChange={(e) => setCreateRunAt(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    Repeat every
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Hour", minutes: 60 },
                      { label: "Day", minutes: 1440 },
                      { label: "Week", minutes: 10080 },
                      { label: "Month", minutes: 43200 },
                    ].map((opt) => (
                      <button
                        key={opt.minutes}
                        type="button"
                        onClick={() => setCreateInterval(opt.minutes)}
                        className={cn(
                          "rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors",
                          createInterval === opt.minutes
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {createError && (
                <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>
              )}

              <Button
                onClick={handleCreate}
                disabled={!canCreate || creating}
                className="w-full rounded-xl"
              >
                {creating ? (
                  <>
                    <Loader2 className="size-4 mr-1 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create task"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>
    </MotionConfig>
  );
}

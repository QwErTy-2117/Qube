"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Loader2, Check, Plus, Trash2, Clock, Calendar, CalendarDays, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PromptPill } from "@/components/shared/prompt-pill";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Column,
  gentleSpring,
  type ColumnData,
  type ColumnStatus,
  type DragState,
} from "@/components/ui/kanban-board";
import { isTaskDone } from "@/lib/scheduler/board-status";

interface ScheduledTask {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: "interval" | "once" | "none";
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  lastRunAt: number | null;
  // null = manual task, never auto-runs (matches lib/scheduler/types.ts).
  nextRunAt: number | null;
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  // Re-evaluate interval windows while the tab stays open, so a recurring
  // task leaves Done when its period rolls over.
  const [now, setNow] = useState(() => Date.now());
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
  const [createKind, setCreateKind] = useState<"once" | "interval" | "none">("once");
  const [createRunAt, setCreateRunAt] = useState("");
  const [createInterval, setCreateInterval] = useState(1440);
  // Wall-clock fields from AI drafts (hour/minute/weekdays/monthDay) that the
  // form has no widgets for — carried through to the create body.
  const [createClock, setCreateClock] = useState<{
    hour?: number;
    minute?: number;
    weekdays?: number[];
    monthDay?: number;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // AI draft flow: prompt -> generating -> review (prefilled form).
  const [draftStage, setDraftStage] = useState<"prompt" | "generating" | "review">("review");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Every scheduled task lives on the board — pending interval (recurring)
  // tasks as well as one-shots. Ran one-shots and recurring tasks that
  // already ran in their current interval window count as Done.
  const boardTasks = useMemo(
    () => tasks.filter((t) => t.type === "scheduled"),
    [tasks]
  );

  // Columns always match task state: done when ran, in progress while the
  // execution triggered from the board is running, to do otherwise. Done
  // covers current-period runs — rerunnable recurring cards can be dragged
  // back to In progress.
  const columns: ColumnData[] = useMemo(() => {
    const buckets: Record<ColumnStatus, ScheduledTask[]> = {
      todo: [],
      "in-progress": [],
      done: [],
    };
    for (const task of boardTasks) {
      if (isTaskDone(task, now)) {
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
        cards: buckets.done.map((t) => ({
          id: t.id,
          title: t.name,
          done: true,
          persist: t.schedule.kind === "interval",
          // Recurring cards can be dragged Done -> In progress to re-run.
          // One-shots stay locked (terminal).
          rerunnable: t.schedule.kind === "interval",
        })),
      },
    ];
  }, [boardTasks, runningIds, now]);

  // Dropping a card into In progress triggers the task for real. Anything
  // else is a no-op — placement always derives from task state.
  const triggerTask = useCallback(
    async (id: string) => {
      if (runningRef.current.has(id)) return;
      const task = boardTasks.find((t) => t.id === id);
      if (!task) return;
      // Finished one-shots are terminal; recurring tasks stay re-runnable and
      // fresh timestamps keep them in Done.
      if (task.schedule.kind === "once" && isTaskDone(task, Date.now())) return;
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
    // Safety net: recurring tasks are never deleted by the Done-column
    // overflow — they return to To do when their period rolls over.
    const task = tasks.find((t) => t.id === cardId);
    if (task && task.schedule.kind === "interval") return;
    setTasks((prev) => prev.filter((t) => t.id !== cardId));
    fetch("/api/scheduler/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: cardId }),
    }).catch(() => {});
  }, [tasks]);

  const handleDrop = useCallback(
    (cardId: string, fromColumnId: ColumnStatus, toColumnId: ColumnStatus) => {
      if (fromColumnId === toColumnId) return;
      // Done is locked except for re-runs: a rerunnable (recurring) card may
      // move Done -> In progress. No manual moves into Done.
      if (toColumnId === "done") return;
      if (fromColumnId === "done") {
        const task = boardTasks.find((t) => t.id === cardId);
        if (!task || task.schedule.kind !== "interval") return;
        if (toColumnId !== "in-progress") return;
        triggerTask(cardId);
        return;
      }
      if (toColumnId === "in-progress" && fromColumnId === "todo") {
        triggerTask(cardId);
      }
    },
    [triggerTask, boardTasks]
  );

  function resetCreateForm() {
    setCreateName("");
    setCreateInstructions("");
    setCreateKind("once");
    setCreateRunAt("");
    setCreateInterval(1440);
    setCreateClock(null);
    setCreateError(null);
    setDraftStage("prompt");
    setDraftError(null);
    setDrafting(false);
  }

  const canCreate =
    createName.trim().length > 0 &&
    createInstructions.trim().length > 0 &&
    (createKind === "interval" ||
      createKind === "none" ||
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
          : createKind === "none"
            ? {
                action: "create",
                name: createName.trim(),
                instructions: createInstructions.trim(),
                scheduleKind: "none",
              }
            : {
                action: "create",
                name: createName.trim(),
                instructions: createInstructions.trim(),
                scheduleKind: "interval",
                intervalMinutes: createInterval,
                ...(createClock ?? {}),
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

  function currentDraftInput() {
    const base = { name: createName, instructions: createInstructions, scheduleKind: createKind };
    return createKind === "once"
      ? { ...base, runAt: createRunAt ? new Date(createRunAt).toISOString() : undefined }
      : createKind === "none"
        ? { ...base }
        : { ...base, intervalMinutes: createInterval, ...(createClock ?? {}) };
  }

  async function runDraft(prompt: string, current: unknown) {
    setDrafting(true);
    setDraftError(null);
    setDraftStage("generating");
    try {
      const res = await fetch("/api/scheduler/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.draft) throw new Error(data?.error || "Could not draft the task.");
      applyDraft(data.draft as DraftFromServer);
      setDraftStage("review");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
      setDraftStage("prompt");
    } finally {
      setDrafting(false);
    }
  }

  type DraftFromServer = { name: string; instructions: string; scheduleKind: "once" | "interval" | "none"; intervalMinutes?: number; runAt?: string; hour?: number; minute?: number; weekdays?: number[]; monthDay?: number };

  function applyDraft(d: DraftFromServer) {
    setCreateName(d.name);
    setCreateInstructions(d.instructions);
    setCreateKind(d.scheduleKind === "none" ? "none" : d.scheduleKind);
    if (typeof d.intervalMinutes === "number") setCreateInterval(d.intervalMinutes);
    if (d.hour !== undefined || d.minute !== undefined || d.weekdays !== undefined || d.monthDay !== undefined) {
      setCreateClock({
        ...(d.hour !== undefined ? { hour: d.hour } : {}),
        ...(d.minute !== undefined ? { minute: d.minute } : {}),
        ...(d.weekdays !== undefined ? { weekdays: d.weekdays } : {}),
        ...(d.monthDay !== undefined ? { monthDay: d.monthDay } : {}),
      });
    } else {
      setCreateClock(null);
    }
    if (d.runAt) {
      const t = new Date(d.runAt);
      if (!Number.isNaN(t.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        setCreateRunAt(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`);
      }
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
          <DialogContent className="sm:max-w-md rounded-3xl h-[640px] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>New task</DialogTitle>
              <DialogDescription>
                One-off tasks run once and land in Done. Recurring tasks move to Done for the current period after each run, then return to To do when the next period starts.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto min-h-0">
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
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/30 p-1">
                  {(["once", "interval", "none"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => { setCreateKind(kind); setCreateClock(null); }}
                      className={cn(
                        "rounded-lg py-1.5 text-xs font-semibold transition-colors",
                        createKind === kind
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {kind === "once" ? "Once" : kind === "interval" ? "Recurring" : "None"}
                    </button>
                  ))}
                </div>
              </div>

              {createKind === "once" ? (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    Run at
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring hover:bg-muted/50 transition-colors"
                      >
                        <span className={createRunAt ? "text-foreground" : "text-muted-foreground"}>
                          {createRunAt
                            ? new Date(createRunAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : "Pick a date and time"}
                        </span>
                        <Calendar className="size-4 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-3 space-y-3" align="start">
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { label: "Now", minutes: 0 },
                          { label: "+1h", minutes: 60 },
                          { label: "Tomorrow", minutes: 1440 },
                          { label: "+1d", minutes: 1440 },
                        ].map((opt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              const d = new Date(Date.now() + opt.minutes * 60_000);
                              const pad = (n: number) => String(n).padStart(2, "0");
                              const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                              setCreateRunAt(local);
                            }}
                            className="rounded-full px-3 py-1 text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="datetime-local"
                        value={createRunAt}
                        onChange={(e) => setCreateRunAt(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              ) : createKind === "interval" ? (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    Repeat every
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Hour", minutes: 60, icon: Clock },
                      { label: "Day", minutes: 1440, icon: Calendar },
                      { label: "Week", minutes: 10080, icon: CalendarDays },
                      { label: "Month", minutes: 43200, icon: CalendarRange },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.minutes}
                          type="button"
                          onClick={() => setCreateInterval(opt.minutes)}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                            createInterval === opt.minutes
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className="size-4 shrink-0" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">Custom (minutes)</label>
                    <input
                      type="number"
                      min={1}
                      value={createInterval}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n > 0) setCreateInterval(n);
                      }}
                      className="w-24 px-2 py-1 rounded-lg border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              ) : null}

              {createError && (
                <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>
              )}

              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <PromptPill busy={false} onSend={(t) => runDraft(t, currentDraftInput())} placeholder="Describe an edit…" />
                </div>
                <button
                  onClick={handleCreate}
                  disabled={!canCreate || creating}
                  aria-label="Save task"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {creating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={3} />}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>
    </MotionConfig>
  );
}

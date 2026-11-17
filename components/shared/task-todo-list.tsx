"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { CheckIcon, Loader2, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmGroup } from "@/components/shared/confirm-group";
import { cleanTaskTitle } from "@/lib/todo/display";
import type { ScheduledTask } from "@/lib/scheduler/types";

type LedgerWorkItem = {
  id: string;
  title: string;
  instructions: string;
  status: string;
  taskId?: string;
};

/** One row in the to-do list, whichever store it comes from. */
type TodoRow = {
  key: string;
  title: string;
  instructions: string;
  done: boolean;
  /** Scheduler task id when the row is a manual reminder. */
  taskId?: string;
  /** Heartbeat ledger id when the row is heartbeat work. */
  workId?: string;
};

type TaskTodoListProps = {
  tasks: ScheduledTask[];
  /** Re-fetch the shared task list after a mutation. */
  onChanged: () => void | Promise<void>;
  /** A row requested from the home widget. */
  openTaskId?: string | null;
  /** Optional heartbeat ledger id requested from the home widget. */
  openWorkId?: string | null;
  /** Called once the requested row's editor has been opened. */
  onOpenHandled?: () => void;
  /** Outer section, used for the widget's scroll-to redirect. */
  sectionRef?: RefObject<HTMLDivElement | null>;
};

function isTodoTask(task: ScheduledTask): boolean {
  return (
    task.type === "scheduled" &&
    task.schedule.kind === "none" &&
    task.legacyScheduleRemoved !== true
  );
}

function notifyTasksChanged() {
  try {
    window.dispatchEvent(new Event("qube-tasks-changed"));
  } catch {}
}

/** Ask the configured main model for a short title, matching the scheduler draft flow. */
async function generateTaskTitle(instructions: string): Promise<string> {
  const res = await fetch("/api/scheduler/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: instructions }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.name !== "string" || !data.name.trim()) {
    throw new Error(data?.error || "Could not generate a title.");
  }
  return data.name.trim().slice(0, 120);
}

/**
 * The Tasks tab's to-do section: every manual reminder (the non-recurring,
 * non-scheduled tasks that also feed the home widget) plus any heartbeat
 * ledger work that the widget shows but no task owns. Rows reveal the same
 * edit/delete controls as the MCP server list on hover.
 */
export function TaskTodoList({
  tasks,
  onChanged,
  openTaskId,
  openWorkId,
  onOpenHandled,
  sectionRef,
}: TaskTodoListProps) {
  const [ledger, setLedger] = useState<LedgerWorkItem[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  /** Row being edited; null while creating a new task. */
  const [editingRow, setEditingRow] = useState<TodoRow | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledOpenKey = useRef<string | null>(null);

  const fetchLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/proactivity/work?ledger=1", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      setLedger(Array.isArray(data?.work) ? data.work : []);
    } catch {
      // Keep the last list; the next refresh retries.
    }
  }, []);

  useEffect(() => {
    void fetchLedger();
    const reload = () => void fetchLedger();
    window.addEventListener("qube-tasks-changed", reload);
    return () => window.removeEventListener("qube-tasks-changed", reload);
  }, [fetchLedger]);

  const rows = useMemo<TodoRow[]>(() => {
    const taskRows: TodoRow[] = tasks.filter(isTodoTask).map((task) => ({
      key: `task:${task.id}`,
      title: cleanTaskTitle(task.name),
      instructions: task.instructions,
      done: task.lastRunAt != null,
      taskId: task.id,
    }));
    const ownedTaskIds = new Set(tasks.map((task) => task.id));
    // Ledger rows that already map to any scheduler task would duplicate it;
    // the task row (or the calendar) is the editable one. Everything else
    // (heartbeat findings and agent work) gets its own row here so it can be
    // edited or deleted too.
    const workRows: TodoRow[] = ledger
      .filter((entry) => !entry.taskId || !ownedTaskIds.has(entry.taskId))
      .map((entry) => ({
        key: `work:${entry.id}`,
        title: cleanTaskTitle(entry.title),
        instructions: entry.instructions,
        done: false,
        workId: entry.id,
      }));
    return [...taskRows, ...workRows];
  }, [tasks, ledger]);

  const openCount = rows.filter((row) => !row.done).length;

  const openCreate = () => {
    setEditingRow(null);
    setTitle("");
    setInstructions("");
    setError(null);
    setSaved(false);
    setEditorOpen(true);
  };

  const openEdit = (row: TodoRow) => {
    setEditingRow(row);
    setTitle(row.title);
    setInstructions(row.instructions);
    setError(null);
    setSaved(false);
    setEditorOpen(true);
  };

  useEffect(() => {
    const wanted = openTaskId
      ? `task:${openTaskId}`
      : openWorkId
        ? `work:${openWorkId}`
        : null;
    if (!wanted) {
      handledOpenKey.current = null;
      return;
    }
    if (handledOpenKey.current === wanted) return;
    const row = rows.find((entry) => entry.key === wanted);
    if (!row) return;
    handledOpenKey.current = wanted;
    openEdit(row);
    onOpenHandled?.();
  }, [openTaskId, openWorkId, rows, onOpenHandled]);

  const saveTask = async () => {
    if (saving) return;
    const cleanInstructions = instructions.trim();
    if (!cleanInstructions) {
      setError("Describe what the agent should do.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let name = title.trim();
      if (!name) name = await generateTaskTitle(cleanInstructions);

      if (editingRow?.workId) {
        // Heartbeat ledger row: edit in place, no scheduler task involved.
        const res = await fetch("/api/proactivity/work", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingRow.workId,
            topic: name,
            summary: cleanInstructions,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.item) {
          throw new Error(data?.error || "Could not save the task.");
        }
      } else {
        const payload = editingRow?.taskId
          ? {
              action: "update",
              id: editingRow.taskId,
              name,
              instructions: cleanInstructions,
            }
          : {
              action: "create",
              name,
              instructions: cleanInstructions,
              scheduleKind: "none",
              color: "blue",
            };

        const res = await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.task) {
          throw new Error(data?.error || "Could not save the task.");
        }
      }

      setSaved(true);
      setSaving(false);
      notifyTasksChanged();
      await Promise.all([onChanged(), fetchLedger()]);
      setTimeout(() => {
        setSaved(false);
        setEditorOpen(false);
        setEditingRow(null);
      }, 550);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (row: TodoRow) => {
    if (deletingKey) return;
    setDeletingKey(row.key);
    setError(null);
    try {
      if (row.workId) {
        const res = await fetch("/api/proactivity/work", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.workId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "Could not delete the task.");
        }
      } else if (row.taskId) {
        const res = await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id: row.taskId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "Could not delete the task.");
        }
      }
      if (editingRow?.key === row.key) {
        setEditorOpen(false);
        setEditingRow(null);
      }
      notifyTasksChanged();
      await Promise.all([onChanged(), fetchLedger()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div ref={sectionRef} className="flex shrink-0 flex-col gap-3 scroll-mt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">To-do</h3>
          <p className="text-[11px] text-muted-foreground/70">
            {openCount === 1 ? "1 open task" : `${openCount} open tasks`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs font-semibold"
          onClick={openCreate}
        >
          <PlusIcon className="size-3.5" />
          Add task
        </Button>
      </div>

      {error && !editorOpen && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground/70">
          No to-do tasks yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div
              key={row.key}
              className="group flex items-center justify-between gap-2.5 rounded-lg border border-border bg-muted/10 px-2.5 py-1"
            >
              <span
                className={cn(
                  "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                  row.done
                    ? "border-transparent bg-[#2f7cf6] text-white"
                    : "border-muted-foreground/35",
                )}
                aria-hidden="true"
              >
                {row.done ? <CheckIcon className="size-2" strokeWidth={3} /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-[13px] leading-5 font-medium text-foreground",
                    row.done && "text-muted-foreground line-through",
                  )}
                  title={row.instructions}
                >
                  {row.title}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => openEdit(row)}
                  className="flex size-5 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-blue-500"
                  title="Edit task"
                  aria-label="Edit task"
                >
                  <PencilIcon className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRow(row)}
                  disabled={deletingKey === row.key}
                  className="flex size-5 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-40"
                  title="Delete task"
                  aria-label="Delete task"
                >
                  {deletingKey === row.key ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-3" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setEditorOpen(open);
          if (!open) {
            setEditingRow(null);
            setError(null);
            setSaved(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>{editingRow ? "Edit task" : "Add task"}</DialogTitle>
            <DialogDescription>
              {editingRow
                ? "Update the instructions or title for this to-do."
                : "Tell Qube what to do. The title is optional — leave it blank and it is generated for you."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="todo-task-title" className="text-xs font-semibold">
                Title <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="todo-task-title"
                value={title}
                placeholder="Leave blank to generate one"
                onChange={(event) => setTitle(event.target.value)}
                className="h-9 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="todo-task-instructions" className="text-xs font-semibold">
                Instructions
              </Label>
              <Textarea
                id="todo-task-instructions"
                autoFocus
                value={instructions}
                placeholder="What should the agent do?"
                onChange={(event) => setInstructions(event.target.value)}
                className="min-h-[140px] resize-none rounded-xl"
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <ConfirmGroup
              onCancel={() => setEditorOpen(false)}
              onConfirm={() => void saveTask()}
              saving={saving}
              saved={saved}
              confirmDisabled={!instructions.trim()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

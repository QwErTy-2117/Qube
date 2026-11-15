"use client";

import {
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
import { cleanTaskTitle, orderTodoItems } from "@/lib/todo/display";
import type { ScheduledTask } from "@/lib/scheduler/types";

type TaskTodoListProps = {
  tasks: ScheduledTask[];
  /** Re-fetch the shared task list after a mutation. */
  onChanged: () => void | Promise<void>;
  /** A task requested from the home widget. */
  openTaskId?: string | null;
  /** Called once the requested task's editor has been opened. */
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
    body: JSON.stringify({ prompt: instructions, mode: "title" }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.name !== "string" || !data.name.trim()) {
    throw new Error(data?.error || "Could not generate a title.");
  }
  return data.name.trim().slice(0, 120);
}

/**
 * The Tasks tab's to-do section: every manual reminder (the non-recurring,
 * non-scheduled tasks that also feed the home widget). Rows reveal the same
 * edit/delete controls as the MCP server list on hover.
 */
export function TaskTodoList({
  tasks,
  onChanged,
  openTaskId,
  onOpenHandled,
  sectionRef,
}: TaskTodoListProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledOpenId = useRef<string | null>(null);
  const [orderSeed] = useState(() => Math.random());

  const todoTasks = useMemo(
    () =>
      orderTodoItems(
        tasks
          .filter(isTodoTask)
          .map((task) => ({ ...task, done: task.lastRunAt != null })),
        orderSeed,
      ),
    [tasks, orderSeed],
  );

  const openCreate = () => {
    setEditingTask(null);
    setTitle("");
    setInstructions("");
    setError(null);
    setSaved(false);
    setEditorOpen(true);
  };

  const openEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    setTitle(task.name);
    setInstructions(task.instructions);
    setError(null);
    setSaved(false);
    setEditorOpen(true);
  };

  useEffect(() => {
    if (!openTaskId) {
      handledOpenId.current = null;
      return;
    }
    if (handledOpenId.current === openTaskId) return;
    const task = todoTasks.find((entry) => entry.id === openTaskId);
    if (!task) return;
    handledOpenId.current = openTaskId;
    openEdit(task);
    onOpenHandled?.();
  }, [openTaskId, todoTasks, onOpenHandled]);

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

      const payload = editingTask
        ? {
            action: "update",
            id: editingTask.id,
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

      setSaved(true);
      setSaving(false);
      notifyTasksChanged();
      await onChanged();
      setTimeout(() => {
        setSaved(false);
        setEditorOpen(false);
        setEditingTask(null);
      }, 550);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async (task: ScheduledTask) => {
    if (deletingId) return;
    setDeletingId(task.id);
    setError(null);
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: task.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Could not delete the task.");
      }
      if (editingTask?.id === task.id) {
        setEditorOpen(false);
        setEditingTask(null);
      }
      notifyTasksChanged();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const openCount = todoTasks.filter((task) => task.lastRunAt == null).length;

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

      {todoTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-4 text-center text-xs text-muted-foreground/70">
          No to-do tasks yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {todoTasks.map((task) => {
            const done = task.lastRunAt != null;
            return (
              <div
                key={task.id}
                className="group flex items-center justify-between gap-2.5 rounded-lg border border-border bg-muted/10 px-2.5 py-1"
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                    done
                      ? "border-transparent bg-[#2f7cf6] text-white"
                      : "border-muted-foreground/35",
                  )}
                  aria-hidden="true"
                >
                  {done ? <CheckIcon className="size-2" strokeWidth={3} /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-[13px] leading-5 font-medium text-foreground",
                      done && "text-muted-foreground line-through",
                    )}
                    title={task.instructions}
                  >
                    {cleanTaskTitle(task.name)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => openEdit(task)}
                    className="flex size-5 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-blue-500"
                    title="Edit task"
                    aria-label="Edit task"
                  >
                    <PencilIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteTask(task)}
                    disabled={deletingId === task.id}
                    className="flex size-5 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-40"
                    title="Delete task"
                    aria-label="Delete task"
                  >
                    {deletingId === task.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-3" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setEditorOpen(open);
          if (!open) {
            setEditingTask(null);
            setError(null);
            setSaved(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit task" : "Add task"}</DialogTitle>
            <DialogDescription>
              {editingTask
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

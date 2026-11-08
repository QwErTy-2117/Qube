"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  setHours,
  startOfDay,
} from "date-fns";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  RepeatIcon,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { PromptPill } from "@/components/shared/prompt-pill";
import {
  Column,
  gentleSpring,
  type ColumnData,
  type ColumnStatus,
  type DragState,
} from "@/components/ui/kanban-board";

import {
  EventCalendar,
  useEventCalendarNavigation,
  useEventCalendarView,
} from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarOccurrence,
  EventCalendarProposedUpdate,
  EventCalendarSlotInfo,
} from "@/components/reui/event-calendar/event-calendar-types";

import type { ScheduledTask } from "@/lib/scheduler/types";
import { isTaskDone } from "@/lib/scheduler/board-status";
import {
  compactTime,
  repeatValueFor,
  taskBlock,
  taskOccurrencesInRange,
  type RepeatValue,
} from "@/lib/scheduler/calendar";

type TaskEventData = { task: ScheduledTask };
type TaskCalendarEvent = CalendarEvent<TaskEventData>;

const TASK_COLORS = [
  { value: "blue", label: "Blue", css: "var(--color-blue-500)" },
  { value: "yellow", label: "Yellow", css: "var(--color-yellow-500)" },
  { value: "purple", label: "Purple", css: "var(--color-violet-500)" },
  { value: "pink", label: "Pink", css: "var(--color-rose-500)" },
  { value: "green", label: "Green", css: "var(--color-emerald-500)" },
  { value: "orange", label: "Orange", css: "var(--color-orange-500)" },
] as const;

const VIEW_ORDER: Array<{ value: CalendarView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

const REPEAT_OPTIONS: Array<{ value: RepeatValue; label: string }> = [
  { value: "once", label: "Once" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const REPEAT_LABELS: Record<RepeatValue, string> = {
  once: "Once",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom schedule",
};

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const minutes = index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const label = format(new Date(2000, 0, 1, hour, minute), "h:mm a");
  return { value, label };
});

const CALENDAR_INTERACTIONS = {
  drag: true,
  resize: true,
  selectSlot: false,
} as const;

// Stable identity: the calendar diffs option props by reference, so a fresh
// Date/array on every render would reset state.
const TODAY = new Date();
const TASK_VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];
const CALENDAR_CLASS_NAMES = {
  // Reference layout: the day number sits at the top-left of each cell, with
  // event chips stacked underneath. The footer is normally a flow row under
  // the chips, so pin it to the corner and reserve that space in the content.
  monthCellFooter: "absolute left-1.5 top-1 px-1 pb-0",
  monthCellContent: "pt-7",
  monthDayHeader: "truncate px-2 py-2 text-center font-medium",
  // Multi-day bars are absolutely positioned from the row top, so they must
  // clear the pinned day-number row as well.
  monthBarOverlay: "pt-7",
};

const BOARD_LIMITS = { todo: 3, done: 3 } as const;

function isManualTask(task: ScheduledTask): boolean {
  return task.type === "scheduled" && task.schedule.kind === "none";
}

function isCalendarTask(task: ScheduledTask): boolean {
  return (
    task.type === "scheduled" &&
    task.schedule.kind !== "none" &&
    task.legacyScheduleRemoved !== true
  );
}

function colorToken(task: Pick<ScheduledTask, "id" | "color">): string {
  const match = TASK_COLORS.find((color) => color.value === task.color);
  if (match) return match.value;
  let hash = 0;
  for (let i = 0; i < task.id.length; i += 1) {
    hash = (hash * 31 + task.id.charCodeAt(i)) >>> 0;
  }
  return TASK_COLORS[hash % TASK_COLORS.length].value;
}

function colorCss(value: string): string {
  return TASK_COLORS.find((color) => color.value === value)?.css ?? TASK_COLORS[0].css;
}

function taskToEvent(task: ScheduledTask): TaskCalendarEvent {
  const block = taskBlock(task);
  return {
    id: task.id,
    title: task.name,
    start: block.start,
    end: block.end,
    allDay: block.allDay,
    color: colorCss(colorToken(task)),
    data: { task },
    // Pure interval tasks have no wall-clock anchor that can be moved; they
    // can still be resized but not dragged onto another day.
    draggable:
      task.schedule.kind === "once" ||
      task.schedule.hour !== undefined ||
      task.schedule.minute !== undefined,
  };
}

function getTaskOccurrences(
  event: TaskCalendarEvent,
  range: { start: Date; end: Date },
) {
  const task = event.data?.task;
  if (!task) return null;
  return taskOccurrencesInRange(task, range);
}

/**
 * Module-level so its identity never changes: the calendar memoizes event
 * content on this function, and an inline arrow would re-render every chip on
 * every drag frame.
 */
function renderTaskEvent({
  occurrence,
  view,
}: {
  occurrence: EventCalendarOccurrence<TaskEventData>;
  view: CalendarView;
}) {
  const task = occurrence.event.data?.task;
  // A one-shot that already ran keeps its block on the calendar so the history
  // is visible; strike it through instead of hiding it.
  const completed = task?.schedule.kind === "once" && task.lastRunAt != null;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 truncate",
        task?.enabled === false && "opacity-50",
        completed && "line-through opacity-60",
      )}
      // Blend the event colour toward the foreground so the chip text stays a
      // legible, darker shade of the tint in light mode and lifts in dark.
      style={{
        color: `color-mix(in oklab, ${occurrence.event.color} 62%, var(--foreground))`,
      }}
    >
      {view === "month" && !occurrence.allDay && (
        <span className="shrink-0">{compactTime(occurrence.start)}</span>
      )}
      <span className="truncate">{occurrence.event.title}</span>
      {occurrence.isRecurring && (
        <RepeatIcon className="size-2.5 shrink-0 opacity-60" aria-hidden="true" />
      )}
    </span>
  );
}

interface TaskEditor {
  task: ScheduledTask | null;
  title: string;
  description: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  repeat: RepeatValue;
}

interface ReminderEditor {
  task: ScheduledTask | null;
  title: string;
  instructions: string;
}

type DraftFromServer = {
  name: string;
  instructions: string;
  scheduleKind: "once" | "interval" | "none";
  intervalMinutes?: number;
  runAt?: string;
  hour?: number;
  minute?: number;
  weekdays?: number[];
  monthDay?: number;
};

function repeatForDraft(draft: DraftFromServer): RepeatValue {
  if (draft.scheduleKind === "once") return "once";
  if (draft.weekdays && draft.weekdays.length > 0) return "weekly";
  if (draft.monthDay !== undefined) return "monthly";
  if (draft.intervalMinutes === 60) return "hourly";
  if (draft.intervalMinutes === 10_080) return "weekly";
  if (draft.intervalMinutes === 43_200) return "monthly";
  if (draft.intervalMinutes === 1440 || draft.hour !== undefined) return "daily";
  return "daily";
}

function deriveTitle(instructions: string): string {
  const first = instructions
    .split(/[\n.!?]/)
    .map((line) => line.trim())
    .find(Boolean);
  const text = (first || instructions).replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return "Reminder";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Board (non-scheduled heartbeat reminders)
  const [dragState, setDragState] = useState<DragState>(null);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const runningRef = useRef<Set<string>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boardDrafting, setBoardDrafting] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // Reminder create/edit dialog
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderEditor, setReminderEditor] = useState<ReminderEditor | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderDrafting, setReminderDrafting] = useState(false);
  const [reminderDeleteArmed, setReminderDeleteArmed] = useState(false);

  // Scheduled task calendar editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<TaskEditor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorDrafting, setEditorDrafting] = useState(false);
  const [calendarDeleteArmed, setCalendarDeleteArmed] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/scheduler/tasks", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Could not load tasks.");
      }
      const nextTasks = (data?.tasks ?? []).filter(
        (task: ScheduledTask) => task.legacyScheduleRemoved !== true,
      );
      setTasks(nextTasks);
      setFetchError(null);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await fetchTasks();
      setLoading(false);
    })();
    const timer = setInterval(fetchTasks, 60_000);
    return () => clearInterval(timer);
  }, [fetchTasks]);

  useEffect(() => {
    return () => {
      if (deleteTimeout.current) clearTimeout(deleteTimeout.current);
    };
  }, []);

  const boardTasks = useMemo(() => tasks.filter(isManualTask), [tasks]);
  const calendarTasks = useMemo(() => tasks.filter(isCalendarTask), [tasks]);
  const events = useMemo(() => calendarTasks.map(taskToEvent), [calendarTasks]);

  const columns: ColumnData[] = useMemo(() => {
    const buckets: Record<ColumnStatus, ScheduledTask[]> = {
      todo: [],
      "in-progress": [],
      done: [],
    };
    for (const task of boardTasks) {
      if (isTaskDone(task)) {
        buckets.done.push(task);
      } else if (runningIds.includes(task.id)) {
        buckets["in-progress"].push(task);
      } else {
        buckets.todo.push(task);
      }
    }
    buckets.done.sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0));
    return [
      {
        id: "todo",
        title: "To do",
        status: "todo",
        cards: buckets.todo.map((task) => ({
          id: task.id,
          title: task.name,
          done: false,
        })),
      },
      {
        id: "in-progress",
        title: "In progress",
        status: "in-progress",
        cards: buckets["in-progress"].map((task) => ({
          id: task.id,
          title: task.name,
          done: false,
        })),
      },
      {
        id: "done",
        title: "Done",
        status: "done",
        cards: buckets.done.map((task) => ({
          id: task.id,
          title: task.name,
          done: true,
          rerunnable: false,
        })),
      },
    ];
  }, [boardTasks, runningIds]);

  const persistUpdate = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const response = await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", ...body }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.task) {
          throw new Error(data?.error || "Could not update the task.");
        }
        await fetchTasks();
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : String(error));
        await fetchTasks();
      }
    },
    [fetchTasks],
  );

  const applyOptimisticTaskPatch = useCallback(
    (id: string, body: Record<string, unknown>) => {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== id) return task;
          const next: ScheduledTask = { ...task };
          if (typeof body.name === "string") next.name = body.name;
          if (typeof body.instructions === "string") next.instructions = body.instructions;
          if (typeof body.color === "string") next.color = body.color;
          if (typeof body.location === "string") next.location = body.location;
          if (typeof body.durationMinutes === "number") {
            next.durationMinutes = body.durationMinutes;
          }
          if (typeof body.allDay === "boolean") next.allDay = body.allDay;
          if (body.scheduleKind === "once" || body.scheduleKind === "interval") {
            const runAt =
              typeof body.runAt === "string" ? Date.parse(body.runAt) : undefined;
            next.schedule = {
              kind: body.scheduleKind,
              intervalMinutes:
                body.scheduleKind === "interval"
                  ? (body.intervalMinutes as number | undefined)
                  : undefined,
              runAt: body.scheduleKind === "once" ? runAt : undefined,
              hour: body.scheduleKind === "interval" ? (body.hour as number | undefined) : undefined,
              minute: body.scheduleKind === "interval" ? (body.minute as number | undefined) : undefined,
              weekdays: body.scheduleKind === "interval" ? (body.weekdays as number[] | undefined) : undefined,
              monthDay: body.scheduleKind === "interval" ? (body.monthDay as number | undefined) : undefined,
            };
            next.nextRunAt =
              body.scheduleKind === "once" && runAt
                ? runAt
                : next.nextRunAt ?? Date.now();
            if (body.scheduleKind === "interval" && body.hour === undefined) {
              next.nextRunAt =
                Date.now() + ((body.intervalMinutes as number) ?? 30) * 60_000;
            }
          }
          return next;
        }),
      );
    },
    [],
  );

  const handleEventUpdate = useCallback(
    (update: EventCalendarProposedUpdate<TaskEventData>) => {
      const task = update.event.data?.task;
      if (!task) return false;
      const durationMinutes = Math.max(
        5,
        Math.round((update.end.getTime() - update.start.getTime()) / 60_000),
      );
      const moved =
        update.source === "drag" ||
        update.source === "keyboard" ||
        update.source === "resize-start";

      // Month-view drags are day-granular: the calendar reports a midnight
      // start. Keep the task's original wall-clock time and apply only the day
      // delta, so dragging a 9am task to another date doesn't silently move it
      // to midnight.
      const occurrenceStart = update.occurrence?.start;
      const startIsMidnight =
        update.start.getHours() === 0 && update.start.getMinutes() === 0;
      const occurrenceHasTime =
        occurrenceStart != null &&
        (occurrenceStart.getHours() !== 0 || occurrenceStart.getMinutes() !== 0);
      let effectiveStart = update.start;
      if (moved && occurrenceStart && startIsMidnight && occurrenceHasTime) {
        const dayDelta = differenceInCalendarDays(update.start, occurrenceStart);
        effectiveStart = addDays(occurrenceStart, dayDelta);
      }

      if (task.schedule.kind === "once") {
        const body: Record<string, unknown> = moved
          ? {
              id: task.id,
              scheduleKind: "once",
              runAt: effectiveStart.toISOString(),
              durationMinutes,
              allDay: update.allDay,
            }
          : { id: task.id, durationMinutes, allDay: update.allDay };
        applyOptimisticTaskPatch(task.id, body);
        void persistUpdate(body);
        return true;
      }

      if (moved) {
        if (task.schedule.hour === undefined && task.schedule.minute === undefined) {
          return false;
        }
        const schedule: Record<string, unknown> = {
          id: task.id,
          scheduleKind: "interval",
          intervalMinutes: task.schedule.intervalMinutes,
          hour: effectiveStart.getHours(),
          minute: effectiveStart.getMinutes(),
          durationMinutes,
          allDay: update.allDay,
        };
        if (task.schedule.weekdays && task.schedule.weekdays.length > 0) {
          schedule.weekdays = [effectiveStart.getDay()];
        }
        if (task.schedule.monthDay !== undefined) {
          schedule.monthDay = effectiveStart.getDate();
        }
        applyOptimisticTaskPatch(task.id, schedule);
        void persistUpdate(schedule);
      } else {
        const body = { id: task.id, durationMinutes, allDay: update.allDay };
        applyOptimisticTaskPatch(task.id, body);
        void persistUpdate(body);
      }
      return true;
    },
    [persistUpdate, applyOptimisticTaskPatch],
  );

  const triggerTask = useCallback(
    async (id: string) => {
      if (runningRef.current.has(id)) return;
      const task = boardTasks.find((item) => item.id === id);
      if (!task) return;
      if (isTaskDone(task)) return;
      runningRef.current.add(id);
      setRunningIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setBoardError(null);
      try {
        const response = await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger", id }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Could not run the reminder.");
        }
      } catch (error) {
        setBoardError(error instanceof Error ? error.message : String(error));
      } finally {
        runningRef.current.delete(id);
        setRunningIds((prev) => prev.filter((running) => running !== id));
        await fetchTasks();
      }
    },
    [boardTasks, fetchTasks],
  );

  const deleteManualTask = useCallback(
    async (id: string) => {
      setTasks((prev) => prev.filter((task) => task.id !== id));
      try {
        const response = await fetch("/api/scheduler/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Could not delete the reminder.");
        }
      } catch (error) {
        setBoardError(error instanceof Error ? error.message : String(error));
      } finally {
        await fetchTasks();
      }
    },
    [fetchTasks],
  );

  const handleCardGone = useCallback(
    (cardId: string) => {
      void deleteManualTask(cardId);
    },
    [deleteManualTask],
  );

  const handleDrop = useCallback(
    (cardId: string, fromColumnId: ColumnStatus, toColumnId: ColumnStatus) => {
      if (fromColumnId === toColumnId) return;
      if (toColumnId === "done") return;
      if (fromColumnId === "done") return;
      if (toColumnId === "in-progress" && fromColumnId === "todo") {
        void triggerTask(cardId);
      }
    },
    [triggerTask],
  );

  const openReminderCreate = useCallback((seed?: { title?: string; instructions?: string }) => {
    setReminderEditor({
      task: null,
      title: seed?.title ?? "",
      instructions: seed?.instructions ?? "",
    });
    setReminderError(null);
    setReminderDeleteArmed(false);
    setReminderOpen(true);
  }, []);

  const openReminderEdit = useCallback(
    (id: string) => {
      const task = tasks.find((item) => item.id === id);
      if (!task || task.schedule.kind !== "none") return;
      setReminderEditor({
        task,
        title: task.name,
        instructions: task.instructions,
      });
      setReminderError(null);
      setReminderDeleteArmed(false);
      setReminderOpen(true);
    },
    [tasks],
  );

  const closeReminder = useCallback(() => {
    if (reminderSaving) return;
    setReminderOpen(false);
    setReminderEditor(null);
    setReminderError(null);
    setReminderDeleteArmed(false);
  }, [reminderSaving]);

  const patchReminder = useCallback((patch: Partial<ReminderEditor>) => {
    setReminderEditor((current) => (current ? { ...current, ...patch } : current));
    setReminderError(null);
  }, []);

  async function generateTitle(instructions: string): Promise<string | null> {
    try {
      const response = await fetch("/api/scheduler/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: instructions, mode: "title" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.name !== "string") return null;
      return data.name.trim() || null;
    } catch {
      return null;
    }
  }

  async function saveReminder() {
    if (!reminderEditor || reminderSaving) return;
    const instructions = reminderEditor.instructions.trim();
    if (!instructions) {
      setReminderError("Describe what the heartbeat should do.");
      return;
    }
    setReminderSaving(true);
    setReminderError(null);
    try {
      let title = reminderEditor.title.trim();
      if (!title) {
        title = (await generateTitle(instructions)) || deriveTitle(instructions);
        setReminderEditor((current) => (current ? { ...current, title } : current));
      }
      const response = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(reminderEditor.task
            ? { action: "update", id: reminderEditor.task.id }
            : { action: "create" }),
          name: title,
          instructions,
          scheduleKind: "none",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.task) {
        throw new Error(data?.error || "Could not save the reminder.");
      }
      setReminderOpen(false);
      setReminderEditor(null);
      await fetchTasks();
    } catch (error) {
      setReminderError(error instanceof Error ? error.message : String(error));
    } finally {
      setReminderSaving(false);
    }
  }

  async function deleteReminder() {
    if (!reminderEditor?.task || reminderSaving) return;
    if (!reminderDeleteArmed) {
      setReminderDeleteArmed(true);
      return;
    }
    setReminderSaving(true);
    setReminderError(null);
    try {
      const response = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: reminderEditor.task.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Could not delete the reminder.");
      }
      setReminderOpen(false);
      setReminderEditor(null);
      await fetchTasks();
    } catch (error) {
      setReminderError(error instanceof Error ? error.message : String(error));
    } finally {
      setReminderSaving(false);
    }
  }

  const runBoardDraft = useCallback(
    async (prompt: string) => {
      setBoardDrafting(true);
      setBoardError(null);
      try {
        const response = await fetch("/api/scheduler/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            current: { name: "", instructions: "", scheduleKind: "none" },
            allowManual: true,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.draft) {
          throw new Error(data?.error || "Could not draft the reminder.");
        }
        const draft = data.draft as DraftFromServer;
        openReminderCreate({
          title: draft.name,
          instructions: draft.instructions,
        });
      } catch (error) {
        setBoardError(error instanceof Error ? error.message : String(error));
      } finally {
        setBoardDrafting(false);
      }
    },
    [openReminderCreate],
  );

  const runReminderDraft = useCallback(
    async (prompt: string) => {
      if (!reminderEditor) return;
      setReminderDrafting(true);
      setReminderError(null);
      try {
        const response = await fetch("/api/scheduler/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            current: {
              name: reminderEditor.title,
              instructions: reminderEditor.instructions,
              scheduleKind: "none",
            },
            allowManual: true,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.draft) {
          throw new Error(data?.error || "Could not draft the reminder.");
        }
        const draft = data.draft as DraftFromServer;
        setReminderEditor((current) =>
          current
            ? {
                ...current,
                title: draft.name || current.title,
                instructions: draft.instructions || current.instructions,
              }
            : current,
        );
      } catch (error) {
        setReminderError(error instanceof Error ? error.message : String(error));
      } finally {
        setReminderDrafting(false);
      }
    },
    [reminderEditor],
  );

  const openCreate = useCallback((seed?: { start: Date; end: Date; allDay?: boolean }) => {
    let start: Date;
    let end: Date;
    if (seed) {
      start = seed.start;
      end = seed.end;
    } else {
      start = new Date();
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
      end = addMinutes(start, 60);
    }
    setEditor({
      task: null,
      title: "",
      description: "",
      start,
      end,
      allDay: false,
      color: TASK_COLORS[0].value,
      repeat: "once",
    });
    setEditorError(null);
    setCalendarDeleteArmed(false);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((occurrence: EventCalendarOccurrence<TaskEventData>) => {
    const task = occurrence.event.data?.task;
    if (!task) return;
    setEditor({
      task,
      title: task.name,
      description: task.instructions,
      start: new Date(occurrence.start),
      end: new Date(occurrence.end),
      allDay: occurrence.allDay,
      color: colorToken(task),
      repeat: repeatValueFor(task),
    });
    setEditorError(null);
    setCalendarDeleteArmed(false);
    setEditorOpen(true);
  }, []);

  // Stable identity: the calendar diffs option props by reference.
  const handleEventClick = useCallback(
    (occurrence: EventCalendarOccurrence<TaskEventData>, event: MouseEvent) => {
      // Opt out of the built-in selection tint; a click opens the editor.
      event.preventDefault();
      openEdit(occurrence);
    },
    [openEdit],
  );

  const handleCreateClick = useCallback(() => openCreate(), [openCreate]);

  const handleSlotClick = useCallback(
    (slot: EventCalendarSlotInfo) => {
      if (slot.view === "month" || slot.allDay) {
        const start = setHours(startOfDay(slot.date), 9);
        openCreate({ start, end: addMinutes(start, 60) });
        return;
      }
      const start = new Date(slot.date);
      openCreate({ start, end: slot.end ?? addMinutes(start, 60) });
    },
    [openCreate],
  );

  const patchEditor = useCallback((patch: Partial<TaskEditor>) => {
    setEditor((current) => (current ? { ...current, ...patch } : current));
    setEditorError(null);
  }, []);

  const setStartDate = useCallback((date: Date) => {
    setEditor((current) => {
      if (!current) return current;
      const delta =
        startOfDay(date).getTime() - startOfDay(current.start).getTime();
      const start = new Date(current.start.getTime() + delta);
      let end = new Date(current.end.getTime() + delta);
      if (end.getTime() <= start.getTime()) end = addMinutes(start, 60);
      return { ...current, start, end };
    });
    setEditorError(null);
  }, []);

  const setStartTime = useCallback((value: string) => {
    setEditor((current) => {
      if (!current) return current;
      const [hour, minute] = value.split(":").map(Number);
      const delta =
        hour * 3_600_000 + minute * 60_000 -
        (current.start.getHours() * 3_600_000 + current.start.getMinutes() * 60_000);
      const start = new Date(current.start.getTime() + delta);
      let end = new Date(current.end.getTime() + delta);
      if (end.getTime() <= start.getTime()) end = addMinutes(start, 60);
      return { ...current, start, end };
    });
    setEditorError(null);
  }, []);

  const setRepeat = useCallback((repeat: RepeatValue) => {
    setEditor((current) => {
      if (!current) return current;
      if (repeat === "once") return { ...current, repeat };
      const start = new Date(current.start);
      const duration = Math.max(
        30,
        Math.round((current.end.getTime() - current.start.getTime()) / 60_000),
      );
      return { ...current, repeat, end: addMinutes(start, duration) };
    });
    setEditorError(null);
  }, []);

  const closeEditor = useCallback(() => {
    if (saving) return;
    setEditorOpen(false);
    setEditor(null);
    setEditorError(null);
    setCalendarDeleteArmed(false);
  }, [saving]);

  function currentDraftInput() {
    if (!editor) return null;
    const base = {
      name: editor.title,
      instructions: editor.description,
    };
    if (editor.repeat === "once") {
      return {
        ...base,
        scheduleKind: "once",
        runAt: editor.start.toISOString(),
      };
    }
    const start = editor.start;
    const schedule = editor.task?.schedule;
    switch (editor.repeat) {
      case "hourly":
        return { ...base, scheduleKind: "interval", intervalMinutes: 60 };
      case "daily":
        return {
          ...base,
          scheduleKind: "interval",
          intervalMinutes: 1440,
          hour: start.getHours(),
          minute: start.getMinutes(),
        };
      case "weekly":
        return {
          ...base,
          scheduleKind: "interval",
          intervalMinutes: 10_080,
          hour: start.getHours(),
          minute: start.getMinutes(),
          weekdays: [start.getDay()],
        };
      case "monthly":
        return {
          ...base,
          scheduleKind: "interval",
          intervalMinutes: 43_200,
          hour: start.getHours(),
          minute: start.getMinutes(),
          monthDay: start.getDate(),
        };
      default:
        return {
          ...base,
          scheduleKind: "interval",
          intervalMinutes: schedule?.intervalMinutes ?? 1440,
          hour: schedule?.hour ?? start.getHours(),
          minute: schedule?.minute ?? start.getMinutes(),
          weekdays: schedule?.weekdays,
          monthDay: schedule?.monthDay,
        };
    }
  }

  const applyEditorDraft = useCallback((draft: DraftFromServer) => {
    setEditor((current) => {
      if (!current || draft.scheduleKind === "none") return current;
      const duration = Math.max(
        30,
        Math.round((current.end.getTime() - current.start.getTime()) / 60_000),
      );
      let start = new Date(current.start);
      if (draft.scheduleKind === "once" && draft.runAt) {
        const runAt = new Date(draft.runAt);
        if (!Number.isNaN(runAt.getTime())) start = runAt;
      } else {
        if (draft.hour !== undefined) {
          start.setHours(draft.hour, draft.minute ?? 0, 0, 0);
        }
        if (draft.weekdays && draft.weekdays.length > 0) {
          let guard = 0;
          while (!draft.weekdays.includes(start.getDay()) && guard < 7) {
            start = addDays(start, 1);
            guard += 1;
          }
        }
        if (draft.monthDay !== undefined) {
          const daysInMonth = new Date(
            start.getFullYear(),
            start.getMonth() + 1,
            0,
          ).getDate();
          start.setDate(Math.min(draft.monthDay, daysInMonth));
        }
      }
      return {
        ...current,
        title: draft.name || current.title,
        description: draft.instructions || current.description,
        start,
        end: addMinutes(start, duration),
        repeat: repeatForDraft(draft),
        allDay: false,
      };
    });
    setEditorError(null);
  }, []);

  const runEditorDraft = useCallback(
    async (prompt: string) => {
      if (!editor) return;
      setEditorDrafting(true);
      setEditorError(null);
      try {
        const response = await fetch("/api/scheduler/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, current: currentDraftInput() }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.draft) {
          throw new Error(data?.error || "Could not draft the task.");
        }
        applyEditorDraft(data.draft as DraftFromServer);
      } catch (error) {
        setEditorError(error instanceof Error ? error.message : String(error));
      } finally {
        setEditorDrafting(false);
      }
    },
    [editor, applyEditorDraft],
  );

  async function saveEditor() {
    if (!editor || saving) return;
    const title = editor.title.trim();
    const description = editor.description.trim();
    if (!title) {
      setEditorError("Give the task a title.");
      return;
    }
    if (!description) {
      setEditorError("Describe what the agent should do.");
      return;
    }
    if (editor.end.getTime() <= editor.start.getTime()) {
      setEditorError("The task needs a positive length.");
      return;
    }
    if (editor.repeat === "once" && editor.start.getTime() <= Date.now()) {
      setEditorError("Pick a time in the future for a one-off task.");
      return;
    }

    const start = editor.allDay ? startOfDay(editor.start) : editor.start;
    const end = editor.allDay
      ? addDays(
          startOfDay(editor.start),
          Math.max(
            1,
            Math.ceil((editor.end.getTime() - editor.start.getTime()) / 86_400_000),
          ),
        )
      : editor.end;
    const durationMinutes = Math.max(
      5,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    );
    const hour = editor.allDay ? 0 : start.getHours();
    const minute = editor.allDay ? 0 : start.getMinutes();

    let schedule: Record<string, unknown>;
    switch (editor.repeat) {
      case "once":
        schedule = { scheduleKind: "once", runAt: start.toISOString() };
        break;
      case "hourly":
        schedule = { scheduleKind: "interval", intervalMinutes: 60 };
        break;
      case "daily":
        schedule = {
          scheduleKind: "interval",
          intervalMinutes: 1440,
          hour,
          minute,
        };
        break;
      case "weekly":
        schedule = {
          scheduleKind: "interval",
          intervalMinutes: 10_080,
          hour,
          minute,
          weekdays: [start.getDay()],
        };
        break;
      case "monthly":
        schedule = {
          scheduleKind: "interval",
          intervalMinutes: 43_200,
          hour,
          minute,
          monthDay: start.getDate(),
        };
        break;
      default: {
        const original = editor.task?.schedule;
        schedule = {
          scheduleKind: "interval",
          intervalMinutes: original?.intervalMinutes ?? 1440,
          hour: original?.hour ?? hour,
          minute: original?.minute ?? minute,
          weekdays: original?.weekdays,
          monthDay: original?.monthDay,
        };
      }
    }

    const payload = {
      ...(editor.task
        ? { action: "update", id: editor.task.id }
        : { action: "create" }),
      name: title,
      instructions: description,
      color: editor.color,
      durationMinutes,
      allDay: editor.allDay,
      ...schedule,
    };

    setSaving(true);
    setEditorError(null);
    try {
      const response = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.task) {
        throw new Error(data?.error || "Could not save the task.");
      }
      setEditorOpen(false);
      setEditor(null);
      await fetchTasks();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (!editor?.task || saving) return;
    setSaving(true);
    setEditorError(null);
    try {
      const response = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", id: editor.task.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Could not run the task.");
      }
      setEditorOpen(false);
      setEditor(null);
      await fetchTasks();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!editor?.task) return;
    if (!calendarDeleteArmed) {
      setCalendarDeleteArmed(true);
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      const response = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: editor.task.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Could not delete the task.");
      }
      setEditorOpen(false);
      setEditor(null);
      await fetchTasks();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const canSave = useMemo(() => {
    if (!editor || saving) return false;
    return (
      editor.title.trim().length > 0 &&
      editor.description.trim().length > 0 &&
      editor.end.getTime() > editor.start.getTime()
    );
  }, [editor, saving]);

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <MotionConfig transition={gentleSpring}>
      <div className="flex h-full min-h-0 w-full flex-col gap-3">
        {fetchError && (
          <p className="shrink-0 text-xs text-red-600 dark:text-red-400" role="alert">
            {fetchError}
          </p>
        )}

        {/* Heartbeat reminders — non-scheduled work the periodic check-in picks up. */}
        <section className="flex h-[38%] min-h-[250px] max-h-[330px] shrink-0 flex-col gap-2.5">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-tight">Reminders</h3>
              <p className="truncate text-[11px] text-muted-foreground">
                The heartbeat picks these up and marks them done.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openReminderCreate()}
              className="h-7 shrink-0 rounded-full px-3 text-xs"
            >
              <Plus className="mr-1 size-3.5" />
              New reminder
            </Button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
            {columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                dragState={dragState}
                setDragState={setDragState}
                onDrop={handleDrop}
                onCardGone={handleCardGone}
                onCardClick={openReminderEdit}
                limits={BOARD_LIMITS}
              />
            ))}
          </div>

          {boardError && (
            <p className="shrink-0 truncate text-[11px] text-red-600 dark:text-red-400" role="alert">
              {boardError}
            </p>
          )}

          <AnimatePresence initial={false} mode="wait">
            {dragState ? (
              <motion.div
                key="delete-zone"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="shrink-0"
              >
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (deleteTimeout.current) clearTimeout(deleteTimeout.current);
                    setDeleteArmed(true);
                  }}
                  onDragLeave={() => {
                    deleteTimeout.current = setTimeout(() => setDeleteArmed(false), 60);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDeleteArmed(false);
                    const cardId =
                      dragState?.cardId || event.dataTransfer.getData("text/plain");
                    if (cardId) void deleteManualTask(cardId);
                    setDragState(null);
                  }}
                  className={cn(
                    "flex h-[38px] items-center justify-center gap-2 rounded-full border border-dashed text-xs font-medium transition-colors",
                    deleteArmed
                      ? "border-red-500 bg-red-500/15 text-red-600 dark:text-red-400"
                      : "border-red-500/40 bg-red-500/5 text-red-600/80 dark:text-red-400/80",
                  )}
                >
                  <Trash2 className="size-3.5" />
                  Drop here to delete
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="board-prompt"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="shrink-0"
              >
                <PromptPill
                  busy={boardDrafting}
                  busyLabel="Drafting the reminder…"
                  placeholder="Describe a reminder — what and where…"
                  onSend={runBoardDraft}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Scheduled tasks calendar */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-background">
          <EventCalendar
            events={events}
            defaultDate={TODAY}
            weekStartsOn={0}
            views={TASK_VIEWS}
            defaultView="month"
            interactions={CALENDAR_INTERACTIONS}
            onSlotClick={handleSlotClick}
            onEventClick={handleEventClick}
            onEventUpdate={handleEventUpdate}
            getOccurrences={getTaskOccurrences}
            loading={loading}
            maxEventsPerCell="auto"
            offDays={false}
            classNames={CALENDAR_CLASS_NAMES}
            renderEvent={renderTaskEvent}
            className="h-full min-h-0 w-full"
          >
            <TaskCalendarHeader onCreate={handleCreateClick} />
            <EventCalendarContent className="min-h-0 flex-1" />
          </EventCalendar>
        </div>

        {/* Reminder create/edit */}
        <Dialog
          open={reminderOpen}
          onOpenChange={(open) => {
            if (!open) closeReminder();
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="flex h-[460px] max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden rounded-3xl border border-border p-0 shadow-2xl sm:max-w-md"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <DialogTitle className="text-base font-semibold tracking-tight">
                {reminderEditor?.task ? "Edit reminder" : "New reminder"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                A reminder the heartbeat executes and completes automatically.
              </DialogDescription>
              <button
                type="button"
                aria-label="Close"
                onClick={closeReminder}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-5 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="reminder-title" className="text-xs font-semibold">
                  Title
                </Label>
                <Input
                  id="reminder-title"
                  autoFocus
                  value={reminderEditor?.title ?? ""}
                  placeholder="Leave blank to generate one"
                  onChange={(event) => patchReminder({ title: event.target.value })}
                  className="h-9 rounded-xl"
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="reminder-instructions" className="text-xs font-semibold">
                  Instructions
                </Label>
                <Textarea
                  id="reminder-instructions"
                  value={reminderEditor?.instructions ?? ""}
                  placeholder="What should the heartbeat do, and where/how should it do it?"
                  onChange={(event) =>
                    patchReminder({ instructions: event.target.value })
                  }
                  className="min-h-0 flex-1 resize-none rounded-xl"
                />
              </div>

              {reminderError && (
                <p className="shrink-0 text-xs text-red-600 dark:text-red-400" role="alert">
                  {reminderError}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
              {reminderEditor?.task && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={deleteReminder}
                  disabled={reminderSaving}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400",
                    reminderDeleteArmed && "bg-red-500/10",
                  )}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  {reminderDeleteArmed ? "Confirm" : "Delete"}
                </Button>
              )}
              <div className="min-w-0 flex-1">
                <PromptPill
                  busy={reminderDrafting}
                  busyLabel="Drafting the reminder…"
                  placeholder="Describe an edit…"
                  onSend={runReminderDraft}
                />
              </div>
              <button
                type="button"
                onClick={saveReminder}
                disabled={reminderSaving || reminderDrafting}
                aria-label="Save reminder"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {reminderSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" strokeWidth={3} />
                )}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Scheduled task create/edit */}
        <Sheet
          open={editorOpen}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          {editor && (
            <SheetContent
              side="right"
              showCloseButton={false}
              className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
                <SheetTitle className="text-lg font-semibold tracking-tight">
                  {editor.task ? "Edit task" : "New task"}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Schedule a task for the agent.
                </SheetDescription>
                <div className="flex items-center gap-1">
                  {editor.task && (
                    <button
                      type="button"
                      aria-label="Run now"
                      title="Run now"
                      onClick={runNow}
                      disabled={saving}
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <Play className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={closeEditor}
                    className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-6 py-5">
                <div className="space-y-1.5">
                  <Label htmlFor="task-title" className="text-xs font-semibold">
                    Title
                  </Label>
                  <Input
                    id="task-title"
                    autoFocus
                    value={editor.title}
                    placeholder="What needs doing?"
                    onChange={(event) => patchEditor({ title: event.target.value })}
                    className="h-9 rounded-xl"
                  />
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="task-description" className="text-xs font-semibold">
                    Instructions
                  </Label>
                  <Textarea
                    id="task-description"
                    value={editor.description}
                    placeholder="What should the agent do?"
                    onChange={(event) =>
                      patchEditor({ description: event.target.value })
                    }
                    className="min-h-0 flex-1 resize-none rounded-xl"
                  />
                </div>

                <div className="grid shrink-0 grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Date</Label>
                    <DateField value={editor.start} onChange={setStartDate} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Time</Label>
                    <TimeField value={editor.start} onChange={setStartTime} />
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2 py-1">
                    {TASK_COLORS.map((color) => {
                      const selected = editor.color === color.value;
                      return (
                        <button
                          key={color.value}
                          type="button"
                          aria-label={color.label}
                          aria-pressed={selected}
                          onClick={() => patchEditor({ color: color.value })}
                          className="flex size-5 items-center justify-center rounded-full transition-shadow"
                          style={{
                            backgroundColor: color.css,
                            ...(selected
                              ? {
                                  boxShadow: `0 0 0 2px var(--background), 0 0 0 3.5px ${color.css}`,
                                }
                              : {}),
                          }}
                        >
                          {selected && <span className="size-1.5 rounded-full bg-white" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <RepeatIcon
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Select
                      value={editor.repeat}
                      onValueChange={(value) => setRepeat(value as RepeatValue)}
                    >
                      <SelectTrigger className="h-9 w-[126px] rounded-lg">
                        <SelectValue>
                          {REPEAT_LABELS[editor.repeat]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {REPEAT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {editorError && (
                  <p className="shrink-0 text-xs text-red-600 dark:text-red-400" role="alert">
                    {editorError}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
                {editor.task && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={deleteTask}
                    disabled={saving}
                    className={cn(
                      "shrink-0 rounded-full px-2.5 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400",
                      calendarDeleteArmed && "bg-red-500/10",
                    )}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    {calendarDeleteArmed ? "Confirm" : "Delete"}
                  </Button>
                )}
                <div className="min-w-0 flex-1">
                  <PromptPill
                    busy={editorDrafting}
                    busyLabel="Drafting the task…"
                    placeholder="Describe the task — timing optional…"
                    onSend={runEditorDraft}
                  />
                </div>
                <Button
                  type="button"
                  onClick={saveEditor}
                  disabled={!canSave || editorDrafting}
                  className="h-9 shrink-0 rounded-full px-4"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </SheetContent>
          )}
        </Sheet>
      </div>
    </MotionConfig>
  );
}

function TaskCalendarHeader({ onCreate }: { onCreate: () => void }) {
  const { title, prev, next, today } = useEventCalendarNavigation();
  const { view, setView } = useEventCalendarView();
  const viewLabel = VIEW_ORDER.find((item) => item.value === view)?.label ?? "Month";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-lg px-3 text-xs font-semibold"
        onClick={today}
      >
        Today
      </Button>
      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous period"
          onClick={prev}
          className="rounded-lg"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next period"
          onClick={next}
          className="rounded-lg"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <h2 className="ml-1.5 min-w-0 truncate text-base font-semibold tracking-tight">
        {title}
      </h2>
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-3 text-xs font-semibold"
            >
              {viewLabel}
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32 rounded-xl p-1">
            {VIEW_ORDER.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onSelect={() => setView(item.value)}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 rounded-lg px-3 text-xs font-semibold"
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
          New task
        </Button>
      </div>
    </div>
  );
}

function DateField({
  value,
  onChange,
}: {
  value: Date;
  onChange: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="truncate">{format(value, "MMMM do, yyyy")}</span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-xl p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            if (!date) return;
            onChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TimeField({
  value,
  onChange,
  disabled = false,
}: {
  value: Date;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes(),
  ).padStart(2, "0")}`;
  return (
    <Select value={selected} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 rounded-xl">
        <SelectValue>
          {TIME_OPTIONS.find((option) => option.value === selected)?.label ?? selected}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {TIME_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

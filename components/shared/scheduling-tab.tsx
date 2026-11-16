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
import { ConfirmGroup } from "@/components/shared/confirm-group";
import { TaskTodoList } from "@/components/shared/task-todo-list";
import { pushChatError } from "@/components/chat/chat-error-popup";
import { gentleSpring } from "@/components/ui/kanban-board";

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
import type { TaskDraft } from "@/lib/scheduler/task-draft";
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

export type SchedulingFocus = {
  taskId?: string | null;
  workId?: string | null;
  section?: "todo" | null;
  nonce: number;
};

export function SchedulingTab({
  focus = null,
  onFocusHandled,
}: {
  focus?: SchedulingFocus | null;
  onFocusHandled?: () => void;
} = {}) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Scheduled task calendar editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<TaskEditor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [calendarDeleteArmed, setCalendarDeleteArmed] = useState(false);
  const saveCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic per-open-sheet id. A generation/save that finishes after the
  // sheet was closed (or replaced by another task) must not touch its UI.
  const editorSessionRef = useRef(0);

  // Home-widget deep links: scroll to the to-do section and open the row.
  const todoSectionRef = useRef<HTMLDivElement | null>(null);
  const [todoFocusTaskId, setTodoFocusTaskId] = useState<string | null>(null);
  const [todoFocusWorkId, setTodoFocusWorkId] = useState<string | null>(null);
  const [scrollToTodoSignal, setScrollToTodoSignal] = useState(0);
  const handledFocusNonce = useRef<number | null>(null);

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

  // A background save (the editor/settings closed while the generator was
  // still working) may finish after this tab mounts. Refresh on the shared
  // task event so the new row appears without reopening settings.
  useEffect(() => {
    const reload = () => {
      void fetchTasks();
    };
    window.addEventListener("qube-tasks-changed", reload);
    return () => window.removeEventListener("qube-tasks-changed", reload);
  }, [fetchTasks]);

  useEffect(() => {
    return () => {
      if (saveCloseTimer.current) clearTimeout(saveCloseTimer.current);
      // Generation intentionally keeps running after the editor/settings
      // close: the request completes and saves the task in the background.
    };
  }, []);

  const calendarTasks = useMemo(() => tasks.filter(isCalendarTask), [tasks]);
  const events = useMemo(() => calendarTasks.map(taskToEvent), [calendarTasks]);

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
    editorSessionRef.current += 1;
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
    editorSessionRef.current += 1;
    setEditorError(null);
    setCalendarDeleteArmed(false);
    setEditorOpen(true);
  }, []);

  /** Open a stored task without needing a calendar occurrence (widget deep link). */
  const openStoredTask = useCallback((task: ScheduledTask) => {
    const block = taskBlock(task);
    setEditor({
      task,
      title: task.name,
      description: task.instructions,
      start: block.start,
      end: block.end,
      allDay: Boolean(task.allDay),
      color: colorToken(task),
      repeat: repeatValueFor(task),
    });
    editorSessionRef.current += 1;
    setEditorError(null);
    setCalendarDeleteArmed(false);
    setEditorOpen(true);
  }, []);

  // Widget rows carry a task id (manual or scheduled). Manual rows open in
  // the to-do section's dialog; scheduled ones open the calendar editor.
  useEffect(() => {
    if (!focus || handledFocusNonce.current === focus.nonce) return;
    if (loading) return;
    handledFocusNonce.current = focus.nonce;

    if (focus.section === "todo") {
      setScrollToTodoSignal((signal) => signal + 1);
    }

    const task = focus.taskId
      ? tasks.find((entry) => entry.id === focus.taskId)
      : undefined;
    if (task) {
      if (task.schedule.kind === "none") {
        setTodoFocusTaskId(task.id);
      } else {
        openStoredTask(task);
      }
    } else if (focus.workId) {
      // Heartbeat ledger row shown by the widget but not backed by a task.
      setTodoFocusWorkId(focus.workId);
    }

    onFocusHandled?.();
  }, [focus, loading, tasks, openStoredTask, onFocusHandled]);

  // Let the section render before scrolling, so the redirect lands on the
  // list rather than merely switching to the tab.
  useEffect(() => {
    if (scrollToTodoSignal === 0) return;
    const timer = setTimeout(() => {
      todoSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 90);
    return () => clearTimeout(timer);
  }, [scrollToTodoSignal]);

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
    if (saveCloseTimer.current) {
      clearTimeout(saveCloseTimer.current);
      saveCloseTimer.current = null;
    }
    // Invalidate in-flight generation/save UI updates. Generation itself
    // keeps running and saves in the background after the editor closes.
    editorSessionRef.current += 1;
    setSaved(false);
    setEditorOpen(false);
    setEditor(null);
    setEditorError(null);
    setCalendarDeleteArmed(false);
  }, [saving]);

  async function saveEditor() {
    if (!editor || saving || generating) return;
    const snapshot = editor;
    const session = editorSessionRef.current;
    const typedTitle = snapshot.title.trim();
    const description = snapshot.description.trim();
    if (!description) {
      setEditorError("Describe what the agent should do.");
      return;
    }

    setEditorError(null);
    const stillOpen = () => editorSessionRef.current === session;

    // Leaving the title blank hands the whole task to the main model: it
    // supplies the name, every schedule setting, and improved instructions.
    let generated: TaskDraft | null = null;
    if (!typedTitle) {
      setGenerating(true);
      try {
        const response = await fetch("/api/scheduler/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: description,
            allowManual: false,
            current: snapshot.task
              ? {
                  name: snapshot.task.name,
                  instructions: description,
                  scheduleKind: snapshot.task.schedule.kind,
                  intervalMinutes: snapshot.task.schedule.intervalMinutes,
                  runAt: snapshot.task.schedule.runAt
                    ? new Date(snapshot.task.schedule.runAt).toISOString()
                    : undefined,
                  hour: snapshot.task.schedule.hour,
                  minute: snapshot.task.schedule.minute,
                  weekdays: snapshot.task.schedule.weekdays,
                  monthDay: snapshot.task.schedule.monthDay,
                }
              : null,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.draft) {
          throw new Error(data?.error || "Could not generate the task.");
        }
        generated = data.draft as TaskDraft;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The user closed the sheet/settings while we were thinking; the
        // request kept going, but a real failure still needs to reach them.
        if (stillOpen()) setEditorError(message);
        else pushChatError({ title: "Could not generate the task", message });
        setGenerating(false);
        return;
      }
      setGenerating(false);
    }

    const title = typedTitle || generated?.name?.trim() || "";
    if (!title) {
      const message = "Could not generate a title. Add one first.";
      if (stillOpen()) setEditorError(message);
      else pushChatError({ title: "Task not saved", message });
      return;
    }

    if (snapshot.end.getTime() <= snapshot.start.getTime()) {
      const message = "The task needs a positive length.";
      if (stillOpen()) setEditorError(message);
      else pushChatError({ title: "Task not saved", message });
      return;
    }
    if (
      !generated &&
      snapshot.repeat === "once" &&
      snapshot.start.getTime() <= Date.now()
    ) {
      const message = "Pick a time in the future for a one-off task.";
      if (stillOpen()) setEditorError(message);
      else pushChatError({ title: "Task not saved", message });
      return;
    }

    const start = snapshot.allDay ? startOfDay(snapshot.start) : snapshot.start;
    const end = snapshot.allDay
      ? addDays(
          startOfDay(snapshot.start),
          Math.max(
            1,
            Math.ceil((snapshot.end.getTime() - snapshot.start.getTime()) / 86_400_000),
          ),
        )
      : snapshot.end;
    const durationMinutes = generated
      ? 60
      : Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000));
    const hour = snapshot.allDay ? 0 : start.getHours();
    const minute = snapshot.allDay ? 0 : start.getMinutes();

    let schedule: Record<string, unknown>;
    if (generated) {
      schedule = {
        scheduleKind: generated.scheduleKind,
        intervalMinutes: generated.intervalMinutes,
        runAt: generated.runAt,
        hour: generated.hour,
        minute: generated.minute,
        weekdays: generated.weekdays,
        monthDay: generated.monthDay,
      };
    } else {
      switch (snapshot.repeat) {
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
          const original = snapshot.task?.schedule;
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
    }

    const payload = {
      ...(snapshot.task
        ? { action: "update", id: snapshot.task.id }
        : { action: "create" }),
      name: title,
      // Save the generator's rewritten brief. The typed text is the input
      // request; these instructions are what the background run executes.
      instructions: generated?.instructions?.trim() || description,
      color: snapshot.color,
      durationMinutes,
      allDay: generated ? false : snapshot.allDay,
      ...schedule,
    };

    setSaving(true);
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
      // Let the button group play its saved-check morph before closing — but
      // only if this is still the sheet that started the save.
      if (stillOpen()) {
        setSaved(true);
        saveCloseTimer.current = setTimeout(() => {
          saveCloseTimer.current = null;
          if (editorSessionRef.current !== session) return;
          editorSessionRef.current += 1;
          setSaved(false);
          setEditorOpen(false);
          setEditor(null);
          setEditorError(null);
          setCalendarDeleteArmed(false);
        }, 550);
      }
      await fetchTasks();
      try {
        window.dispatchEvent(new Event("qube-tasks-changed"));
      } catch {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (stillOpen()) setEditorError(message);
      else pushChatError({ title: "Task not saved", message });
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
    if (!editor || saving || generating) return false;
    return (
      editor.description.trim().length > 0 &&
      editor.end.getTime() > editor.start.getTime()
    );
  }, [editor, saving, generating]);

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <MotionConfig transition={gentleSpring}>
      <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto pr-1 scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {fetchError && (
          <p className="shrink-0 text-xs text-red-600 dark:text-red-400" role="alert">
            {fetchError}
          </p>
        )}

        {/* Scheduled tasks calendar: fills the tab like before. The to-do
            section lives below the fold and is reached by scrolling. */}
        <div className="relative flex h-full min-h-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-background">
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

        {/* Manual reminders (the non-recurring tasks that feed the widget). */}
        <TaskTodoList
          tasks={tasks}
          onChanged={fetchTasks}
          openTaskId={todoFocusTaskId}
          openWorkId={todoFocusWorkId}
          onOpenHandled={() => {
            setTodoFocusTaskId(null);
            setTodoFocusWorkId(null);
          }}
          sectionRef={todoSectionRef}
        />

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
              <div className="flex shrink-0 flex-col gap-1 border-b border-border px-6 py-4">
                <SheetTitle className="text-lg font-semibold tracking-tight">
                  {editor.task ? "Edit task" : "New task"}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Schedule a task for the agent.
                </SheetDescription>
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
                      className={cn(
                        "size-3.5",
                        editor.repeat === "once"
                          ? "text-muted-foreground"
                          : "text-blue-500",
                      )}
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

              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
                {/* Close + Run live together on the left. */}
                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/10 px-1.5 py-1.5">
                  <button
                    type="button"
                    aria-label="Close"
                    title="Close"
                    onClick={closeEditor}
                    className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                  {editor.task && (
                    <button
                      type="button"
                      aria-label="Run now"
                      title="Run now"
                      onClick={runNow}
                      disabled={saving || generating}
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <Play className="size-4" />
                    </button>
                  )}
                </div>
                <ConfirmGroup
                  onConfirm={saveEditor}
                  saving={saving || generating}
                  saved={saved}
                  confirmDisabled={!canSave}
                  confirmLabel="Save"
                  leading={
                    editor.task ? (
                      <motion.button
                        layout
                        type="button"
                        onClick={deleteTask}
                        disabled={saving || generating}
                        aria-label={
                          calendarDeleteArmed ? "Confirm delete" : "Delete task"
                        }
                        title={
                          calendarDeleteArmed
                            ? "Click again to delete"
                            : "Delete task"
                        }
                        transition={gentleSpring}
                        className={cn(
                          "flex h-8 items-center justify-center overflow-hidden rounded-full text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-40",
                          calendarDeleteArmed ? "gap-1.5 px-2.5" : "w-8 px-0",
                        )}
                      >
                        <Trash2 className="size-4 shrink-0" />
                        <AnimatePresence initial={false}>
                          {calendarDeleteArmed && (
                            <motion.span
                              key="delete-confirm-label"
                              initial={{ opacity: 0, width: 0 }}
                              animate={{ opacity: 1, width: "auto" }}
                              exit={{ opacity: 0, width: 0 }}
                              transition={gentleSpring}
                              className="overflow-hidden whitespace-nowrap text-xs font-semibold leading-none"
                            >
                              Delete
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    ) : undefined
                  }
                />
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

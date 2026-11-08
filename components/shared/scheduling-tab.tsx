"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  setHours,
  startOfDay,
} from "date-fns";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

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

const VIEW_ORDER: Array<{ value: CalendarView; label: string; shortcut: string }> = [
  { value: "month", label: "Month", shortcut: "M" },
  { value: "week", label: "Week", shortcut: "W" },
  { value: "day", label: "Day", shortcut: "D" },
  { value: "agenda", label: "Agenda", shortcut: "A" },
];

const REPEAT_OPTIONS: Array<{ value: RepeatValue; label: string }> = [
  { value: "once", label: "Once" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

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
  location: string;
  color: string;
  repeat: RepeatValue;
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<TaskEditor | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/scheduler/tasks", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Could not load tasks.");
      }
      // Legacy "none" (manual) tasks were migrated to hidden one-shots so the
      // removed scheduling type never resurfaces on the calendar.
      const nextTasks = (data?.tasks ?? []).filter(
        (task: ScheduledTask) =>
          task.type === "scheduled" && task.legacyScheduleRemoved !== true,
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

  // The calendar derives its events from the task list; drag/resize keeps the
  // local task state as the single source of truth so nothing snaps back.
  const events = useMemo(() => tasks.map(taskToEvent), [tasks]);

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
        // Revert the optimistic calendar write by reloading persisted tasks.
        await fetchTasks();
      }
    },
    [fetchTasks],
  );

  // Drag/resize must not snap back while the PATCH is in flight, so the local
  // task list mirrors the change immediately; a failed request re-fetches and
  // restores the persisted truth.
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
                Date.now() + (body.intervalMinutes as number ?? 30) * 60_000;
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
      allDay: seed?.allDay ?? false,
      location: "",
      color: TASK_COLORS[0].value,
      repeat: "once",
    });
    setEditorError(null);
    setDeleteArmed(false);
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
      location: task.location ?? "",
      color: colorToken(task),
      repeat: repeatValueFor(task),
    });
    setEditorError(null);
    setDeleteArmed(false);
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
      if (slot.view === "month") {
        const start = setHours(startOfDay(slot.date), 9);
        openCreate({ start, end: addMinutes(start, 60) });
        return;
      }
      if (slot.allDay) {
        const start = startOfDay(slot.date);
        openCreate({ start, end: addDays(start, 1), allDay: true });
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

  const setEndDate = useCallback((date: Date) => {
    setEditor((current) => {
      if (!current) return current;
      const end = new Date(current.end);
      end.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      // A recurring task's end is its block length: never let a picked date
      // land before the start, or the duration would go negative.
      if (end.getTime() <= current.start.getTime()) {
        return { ...current, end: addMinutes(current.start, 60) };
      }
      return { ...current, end };
    });
    setEditorError(null);
  }, []);

  const setEndTime = useCallback((value: string) => {
    setEditor((current) => {
      if (!current) return current;
      const [hour, minute] = value.split(":").map(Number);
      const end = new Date(current.end);
      end.setHours(hour, minute, 0, 0);
      return { ...current, end };
    });
    setEditorError(null);
  }, []);

  const setAllDay = useCallback((allDay: boolean) => {
    setEditor((current) => {
      if (!current) return current;
      if (allDay) {
        const days = Math.max(
          1,
          Math.ceil((current.end.getTime() - current.start.getTime()) / 86_400_000),
        );
        const start = startOfDay(current.start);
        return { ...current, allDay: true, start, end: addDays(start, days) };
      }
      const start = setHours(startOfDay(current.start), 9);
      return { ...current, allDay: false, start, end: addMinutes(start, 60) };
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
    setDeleteArmed(false);
  }, [saving]);

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
      setEditorError("The end time must be after the start time.");
      return;
    }
    if (editor.repeat === "once" && editor.start.getTime() <= Date.now()) {
      setEditorError("Pick a time in the future for a one-off task.");
      return;
    }

    const start = editor.allDay ? startOfDay(editor.start) : editor.start;
    const end = editor.allDay
      ? addDays(startOfDay(editor.start), Math.max(
          1,
          Math.ceil((editor.end.getTime() - editor.start.getTime()) / 86_400_000),
        ))
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
      location: editor.location.trim() || undefined,
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
    if (!deleteArmed) {
      setDeleteArmed(true);
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
      editor.end.getTime() > editor.start.getTime() &&
      (editor.repeat !== "once" || editor.start.getTime() > Date.now())
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
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {fetchError && (
        <p className="shrink-0 text-xs text-red-600 dark:text-red-400" role="alert">
          {fetchError}
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
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
                  {editor.task ? "Edit task" : "Create task"}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Schedule a task for the agent.
                </SheetDescription>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={closeEditor}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <div className="space-y-2">
                  <Label htmlFor="task-title" className="text-sm font-semibold">
                    Title
                  </Label>
                  <Input
                    id="task-title"
                    autoFocus
                    value={editor.title}
                    placeholder="What needs doing?"
                    onChange={(event) => patchEditor({ title: event.target.value })}
                    className="h-10 rounded-lg"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-description" className="text-sm font-semibold">
                    Description
                  </Label>
                  <Textarea
                    id="task-description"
                    value={editor.description}
                    placeholder="What should the agent do?"
                    rows={4}
                    onChange={(event) =>
                      patchEditor({ description: event.target.value })
                    }
                    className="min-h-[92px] resize-none rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Start Date</Label>
                    <DateField value={editor.start} onChange={setStartDate} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Start Time</Label>
                    <TimeField
                      value={editor.start}
                      onChange={setStartTime}
                      disabled={editor.allDay}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">End Date</Label>
                    <DateField value={editor.end} onChange={setEndDate} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">End Time</Label>
                    <TimeField
                      value={editor.end}
                      onChange={setEndTime}
                      disabled={editor.allDay}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={editor.allDay}
                      onCheckedChange={(checked) => setAllDay(checked === true)}
                    />
                    All day
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Repeat</span>
                    <Select
                      value={editor.repeat}
                      onValueChange={(value) => setRepeat(value as RepeatValue)}
                    >
                      <SelectTrigger className="h-9 w-[108px] rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPEAT_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            disabled={
                              option.value === "custom" && editor.repeat !== "custom"
                            }
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-location" className="text-sm font-semibold">
                    Location
                  </Label>
                  <Input
                    id="task-location"
                    value={editor.location}
                    placeholder="Optional workspace path or context"
                    onChange={(event) =>
                      patchEditor({ location: event.target.value })
                    }
                    className="h-10 rounded-lg"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Color</Label>
                  <div className="flex items-center gap-2.5 py-1">
                    {TASK_COLORS.map((color) => {
                      const selected = editor.color === color.value;
                      return (
                        <button
                          key={color.value}
                          type="button"
                          aria-label={color.label}
                          aria-pressed={selected}
                          onClick={() => patchEditor({ color: color.value })}
                          className="flex size-7 items-center justify-center rounded-full transition-shadow"
                          style={{
                            backgroundColor: color.css,
                            ...(selected
                              ? {
                                  boxShadow: `0 0 0 2px var(--background), 0 0 0 4px ${color.css}`,
                                }
                              : {}),
                          }}
                        >
                          {selected && <span className="size-2 rounded-full bg-white" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {editor.repeat === "once" &&
                  editor.start.getTime() <= Date.now() && (
                    <p className="text-xs text-muted-foreground" role="status">
                      One-off tasks need a start time in the future. Switch
                      Repeat to a recurring option to keep a past time.
                    </p>
                  )}
                {editorError && (
                  <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                    {editorError}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-6 py-4">
                <div className="flex items-center gap-1">
                  {editor.task && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={runNow}
                        disabled={saving}
                        className="rounded-lg"
                      >
                        <Play className="mr-1 size-3.5" />
                        Run now
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={deleteTask}
                        disabled={saving}
                        className={cn(
                          "rounded-lg text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400",
                          deleteArmed && "bg-red-500/10",
                        )}
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        {deleteArmed ? "Confirm delete" : "Delete"}
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg"
                    onClick={closeEditor}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="rounded-lg"
                    onClick={saveEditor}
                    disabled={!canSave}
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>
            </SheetContent>
          )}
        </Sheet>
      </div>
    </div>
  );
}

function TaskCalendarHeader({ onCreate }: { onCreate: () => void }) {
  const { title, prev, next, today } = useEventCalendarNavigation();
  const { view, setView } = useEventCalendarView();
  const viewLabel = VIEW_ORDER.find((item) => item.value === view)?.label ?? "Month";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
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
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next period"
          onClick={next}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <h2 className="ml-1.5 min-w-0 truncate text-lg font-semibold tracking-tight">
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
          <DropdownMenuContent align="end" className="w-40 rounded-lg">
            {VIEW_ORDER.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onSelect={() => setView(item.value)}
                className="flex items-center justify-between"
              >
                <span>{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.shortcut}</span>
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
          className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      <SelectTrigger className="h-10 rounded-lg">
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

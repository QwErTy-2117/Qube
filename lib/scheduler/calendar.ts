import { addDays, startOfDay } from "date-fns";

import type { ScheduledTask } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OCCURRENCES = 400;

export type TaskOccurrence = { start: Date; end: Date };

export function taskDurationMinutes(task: Pick<ScheduledTask, "durationMinutes">): number {
  return Math.max(5, task.durationMinutes ?? 30);
}

/**
 * The anchor block for a task. Recurring tasks anchor on their next run (or
 * creation time when there is none); one-shot tasks anchor on their run time.
 */
export function taskBlock(task: ScheduledTask): TaskOccurrence & { allDay: boolean } {
  const allDay = Boolean(task.allDay);
  const anchor =
    task.schedule.kind === "once"
      ? task.schedule.runAt ?? task.nextRunAt ?? task.createdAt
      : task.nextRunAt ?? task.createdAt ?? Date.now();
  if (allDay) {
    const start = startOfDay(anchor);
    const days = Math.max(1, Math.round(taskDurationMinutes(task) / 1440));
    return { start, end: addDays(start, days), allDay: true };
  }
  return {
    start: new Date(anchor),
    end: new Date(anchor + taskDurationMinutes(task) * 60_000),
    allDay: false,
  };
}

/**
 * Expand a recurring task into calendar occurrences inside `range`. Returns
 * null for one-shot tasks so the calendar's regular single-event path owns
 * them. Sub-daily cadences collapse to one chip per day on multi-day grids —
 * a month cell should not fill with 24 identical chips.
 */
export function taskOccurrencesInRange(
  task: ScheduledTask,
  range: { start: Date; end: Date },
): TaskOccurrence[] | null {
  if (task.schedule.kind !== "interval") return null;

  const schedule = task.schedule;
  const durationMs = taskDurationMinutes(task) * 60_000;
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  const out: TaskOccurrence[] = [];

  if (schedule.hour !== undefined && schedule.minute !== undefined) {
    const weekdays = Array.isArray(schedule.weekdays) && schedule.weekdays.length > 0
      ? schedule.weekdays
      : null;
    const monthDay = schedule.monthDay;
    // One extra day back covers long blocks that start just before the grid.
    let day = startOfDay(addDays(range.start, -1));
    while (day.getTime() < rangeEnd && out.length < MAX_OCCURRENCES) {
      const matchesWeekday = !weekdays || weekdays.includes(day.getDay());
      const matchesMonthDay = monthDay === undefined || day.getDate() === monthDay;
      if (matchesWeekday && matchesMonthDay) {
        if (task.allDay) {
          const start = startOfDay(day);
          const end = addDays(
            start,
            Math.max(1, Math.round(taskDurationMinutes(task) / 1440)),
          );
          if (end.getTime() > rangeStart && start.getTime() < rangeEnd) {
            out.push({ start, end });
          }
        } else {
          const start = new Date(day);
          start.setHours(schedule.hour, schedule.minute, 0, 0);
          const end = new Date(start.getTime() + durationMs);
          if (end.getTime() > rangeStart && start.getTime() < rangeEnd) {
            out.push({ start, end });
          }
        }
      }
      day = addDays(day, 1);
    }
    return out;
  }

  // Pure interval cadence (every N minutes). Sub-daily cadences collapse to one
  // occurrence per day on multi-day grids so a month stays legible, but a
  // week/day grid shows every run.
  const intervalMs = Math.max(1, schedule.intervalMinutes ?? 30) * 60_000;
  const collapsePerDay =
    Boolean(task.allDay) ||
    (intervalMs < DAY_MS && rangeEnd - rangeStart > 7 * DAY_MS);
  const anchor = task.nextRunAt ?? task.createdAt;
  let cursor = anchor;
  if (cursor < rangeStart - durationMs) {
    cursor += Math.floor((rangeStart - durationMs - cursor) / intervalMs) * intervalMs;
  }
  const seenDays = new Set<string>();
  while (cursor < rangeEnd && out.length < MAX_OCCURRENCES) {
    const start = task.allDay ? startOfDay(cursor) : new Date(cursor);
    const end = task.allDay ? addDays(start, 1) : new Date(cursor + durationMs);
    if (collapsePerDay) {
      const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
      if (!seenDays.has(key)) {
        seenDays.add(key);
        out.push({ start, end });
      }
    } else {
      out.push({ start, end });
    }
    cursor += intervalMs;
  }
  return out;
}

/**
 * Recurrence picker value for an existing schedule. Custom cadences keep their
 * own option so opening and saving an unrelated field never rewrites them.
 */
export type RepeatValue = "once" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

export function repeatValueFor(task: Pick<ScheduledTask, "schedule">): RepeatValue {
  const schedule = task.schedule;
  if (schedule.kind === "once") return "once";
  if (schedule.weekdays && schedule.weekdays.length > 0) return "weekly";
  if (schedule.monthDay !== undefined) return "monthly";
  if (schedule.intervalMinutes === 60 && schedule.hour === undefined) return "hourly";
  if (schedule.intervalMinutes === 1440 && schedule.hour !== undefined) return "daily";
  if (schedule.intervalMinutes === 10_080) return "weekly";
  if (schedule.intervalMinutes === 43_200) return "monthly";
  return "custom";
}

export function compactTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours >= 12 ? "pm" : "am";
  const hour12 = hours % 12 || 12;
  return minutes === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`;
}

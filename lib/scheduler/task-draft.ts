export type TaskDraftScheduleKind = "once" | "interval" | "none";

export interface TaskDraft {
  name: string;
  instructions: string;
  scheduleKind: TaskDraftScheduleKind;
  intervalMinutes?: number;
  runAt?: string;
  hour?: number;
  minute?: number;
  weekdays?: number[];
  monthDay?: number;
}

export interface DraftInput {
  name: string;
  instructions: string;
  scheduleKind: TaskDraftScheduleKind;
  intervalMinutes?: number;
  runAt?: string;
  hour?: number;
  minute?: number;
  weekdays?: number[];
  monthDay?: number;
}

const KINDS: TaskDraftScheduleKind[] = ["once", "interval", "none"];

/** System prompt for the drafting model. Pure — no I/O, no date mocking inside. */
export function buildDraftSystemPrompt(): string {
  return [
    "You turn a short task request into a scheduled-task draft.",
    'Reply with ONE JSON object only: {"name": string, "instructions": string,',
    ' "scheduleKind": "once"|"interval"|"none", "intervalMinutes"?: number, "runAt"?: string (ISO future),',
    ' "hour"?: 0-23, "minute"?: 0-59, "weekdays"?: [0-6 Sun-Sat], "monthDay"?: 1-31}.',
    "Rules: explicit timing wins; recurring language means interval or wall-clock fields;",
    "a one-off reminder with no time means scheduleKind none;",
    "ambiguous means a sensible default, never an empty schedule.",
    "Name is short (<= 60 chars); instructions tell the agent exactly what to do.",
  ].join(" ");
}

/** User message: request + current draft + current date/time context. */
export function buildDraftPrompt(prompt: string, current: DraftInput | null): string {
  const now = new Date();
  const lines = [
    `Current date/time: ${now.toISOString()} (local timezone offset ${-now.getTimezoneOffset()} minutes).`,
    `Request: ${prompt.trim()}`,
  ];
  if (current) lines.push(`Current draft (revise it per the request): ${JSON.stringify(current, null, 2)}`);
  return lines.join("\n");
}

export type ValidateResult = { ok: true; draft: TaskDraft } | { ok: false; error: string };

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

/** Strict shape/range check for model output. Never throws. */
export function validateDraft(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Draft must be a JSON object." };
  const d = raw as Record<string, unknown>;
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const instructions = typeof d.instructions === "string" ? d.instructions.trim() : "";
  if (!name) return { ok: false, error: "Draft needs a non-empty name." };
  if (!instructions) return { ok: false, error: "Draft needs non-empty instructions." };
  if (typeof d.scheduleKind !== "string" || !(KINDS as string[]).includes(d.scheduleKind)) {
    return { ok: false, error: "Draft needs scheduleKind once|interval|none." };
  }
  const draft: TaskDraft = { name: name.slice(0, 120), instructions, scheduleKind: d.scheduleKind as TaskDraftScheduleKind };
  if (d.intervalMinutes !== undefined) {
    if (typeof d.intervalMinutes !== "number" || !(d.intervalMinutes > 0)) return { ok: false, error: "intervalMinutes must be positive." };
    draft.intervalMinutes = d.intervalMinutes;
  }
  if (d.runAt !== undefined) {
    if (typeof d.runAt !== "string" || Number.isNaN(Date.parse(d.runAt))) return { ok: false, error: "runAt must be an ISO date." };
    if (Date.parse(d.runAt) <= Date.now()) return { ok: false, error: "runAt must be in the future." };
    draft.runAt = d.runAt;
  }
  if (d.hour !== undefined) {
    if (!isInt(d.hour) || d.hour < 0 || d.hour > 23) return { ok: false, error: "hour must be 0-23." };
    draft.hour = d.hour;
  }
  if (d.minute !== undefined) {
    if (!isInt(d.minute) || d.minute < 0 || d.minute > 59) return { ok: false, error: "minute must be 0-59." };
    draft.minute = d.minute;
  }
  if (d.weekdays !== undefined) {
    if (!Array.isArray(d.weekdays) || !d.weekdays.every((w) => isInt(w) && w >= 0 && w <= 6)) {
      return { ok: false, error: "weekdays must be 0-6." };
    }
    draft.weekdays = [...d.weekdays];
  }
  if (d.monthDay !== undefined) {
    if (!isInt(d.monthDay) || d.monthDay < 1 || d.monthDay > 31) return { ok: false, error: "monthDay must be 1-31." };
    draft.monthDay = d.monthDay;
  }
  return { ok: true, draft };
}

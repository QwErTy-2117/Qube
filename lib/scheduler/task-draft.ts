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

export type DraftOptions = {
  /** Board reminders have no clock; the model may answer scheduleKind=none. */
  allowManual?: boolean;
};

const KINDS_SCHEDULED: TaskDraftScheduleKind[] = ["once", "interval"];
const KINDS_ALL: TaskDraftScheduleKind[] = ["once", "interval", "none"];

/** System prompt for the drafting model. Pure — no I/O, no date mocking inside. */
export function buildDraftSystemPrompt(opts?: DraftOptions): string {
  const allowManual = opts?.allowManual === true;
  return [
    allowManual
      ? "You turn a short request into a task draft. The user is creating a heartbeat reminder unless they ask for a schedule."
      : "You turn a short task request into a scheduled-task draft.",
    'Reply with ONE JSON object only: {"name": string, "instructions": string,',
    allowManual
      ? ' "scheduleKind": "none"|"once"|"interval", "intervalMinutes"?: number, "runAt"?: string (ISO future),'
      : ' "scheduleKind": "once"|"interval", "intervalMinutes"?: number, "runAt"?: string (ISO future),',
    ' "hour"?: 0-23, "minute"?: 0-59, "weekdays"?: [0-6 Sun-Sat], "monthDay"?: 1-31}.',
    "Rules: explicit timing wins; recurring language means interval or wall-clock fields;",
    allowManual
      ? "a reminder with no explicit time means scheduleKind none;"
      : "a one-off reminder with no explicit time means scheduleKind once at the next sensible hour;",
    "ambiguous means a sensible default, never an empty schedule.",
    "Name is short (<= 60 chars); instructions tell the agent exactly what to do, including where/how.",
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

/** Title-only generation for a reminder whose title was left blank. */
export function buildTitleSystemPrompt(): string {
  return [
    "Give a short, concrete title for a task reminder.",
    'Reply with ONE JSON object only: {"name": string}.',
    "The name must be 3-60 characters, title case, and describe the action — never a generic label like 'Task' or 'Reminder'.",
  ].join(" ");
}

export function buildTitlePrompt(instructions: string): string {
  return `Reminder instructions:\n${instructions.trim().slice(0, 4000)}`;
}

export type ValidateResult = { ok: true; draft: TaskDraft } | { ok: false; error: string };
export type ValidateTitleResult = { ok: true; name: string } | { ok: false; error: string };

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function parseName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 120) : "";
}

/** Strict shape/range check for model output. Never throws. */
export function validateDraft(raw: unknown, opts?: DraftOptions): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Draft must be a JSON object." };
  const d = raw as Record<string, unknown>;
  const name = parseName(d.name);
  const instructions = typeof d.instructions === "string" ? d.instructions.trim() : "";
  if (!name) return { ok: false, error: "Draft needs a non-empty name." };
  if (!instructions) return { ok: false, error: "Draft needs non-empty instructions." };
  const kinds = opts?.allowManual === true ? KINDS_ALL : KINDS_SCHEDULED;
  if (typeof d.scheduleKind !== "string" || !(kinds as string[]).includes(d.scheduleKind)) {
    return {
      ok: false,
      error: opts?.allowManual
        ? "Draft needs scheduleKind once, interval, or none."
        : "Draft needs scheduleKind once or interval.",
    };
  }
  const draft: TaskDraft = { name, instructions, scheduleKind: d.scheduleKind as TaskDraftScheduleKind };
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
  // Never hand the UI a schedule it cannot save: a one-shot without a time
  // lands on the next full hour, and a recurring task without timing defaults
  // to a daily cadence. Manual reminders deliberately have no timing fields.
  if (draft.scheduleKind === "once" && !draft.runAt) {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setMinutes(0, 0, 0);
    draft.runAt = next.toISOString();
  }
  if (
    draft.scheduleKind === "interval" &&
    draft.intervalMinutes === undefined &&
    draft.hour === undefined
  ) {
    draft.intervalMinutes = 1440;
  }
  if (draft.scheduleKind === "none") {
    delete draft.intervalMinutes;
    delete draft.runAt;
    delete draft.hour;
    delete draft.minute;
    delete draft.weekdays;
    delete draft.monthDay;
  }
  return { ok: true, draft };
}

/** Strict title-only validation used when the user leaves the title empty. */
export function validateTitleDraft(raw: unknown): ValidateTitleResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Title must be a JSON object." };
  const name = parseName((raw as Record<string, unknown>).name);
  if (!name) return { ok: false, error: "Draft needs a non-empty name." };
  return { ok: true, name };
}

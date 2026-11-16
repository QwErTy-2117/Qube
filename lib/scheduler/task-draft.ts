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

/**
 * Pull the first balanced `{...}` object out of arbitrary model text.
 * Handles prose before/after the object, fenced blocks and braces inside
 * JSON strings; returns null when the text contains no object at all.
 */
export function extractJsonObject(text: string): string | null {
  const cleaned = String(text || "").replace(/```(?:json)?/gi, "");
  let start = cleaned.indexOf("{");
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return cleaned.slice(start, i + 1);
      }
    }
    start = cleaned.indexOf("{", start + 1);
  }
  return null;
}

/** Escape literal newlines/control chars that models put inside JSON strings. */
function escapeControlCharsInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of input) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
    } else {
      out += ch;
      if (ch === '"') inString = true;
    }
  }
  return out;
}

/** JSON.parse with the model mistakes that are safe to repair. */
export function parseJsonLoose(slice: string): unknown | null {
  try {
    return JSON.parse(slice);
  } catch {
    // fall through to repairs
  }
  const repaired = escapeControlCharsInStrings(
    slice
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201c\u201d]/g, '"'),
  );
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/** Short, concrete title derived from the instructions (fallback path). */
export function titleFromInstructions(instructions: string): string {
  let text = String(instructions || "").replace(/\s+/g, " ").trim();
  text = text.replace(
    /^(please\s+)?(remind me to|remember to|i need to|i want to|can you|could you|would you|make sure to|don'?t forget to)\s+/i,
    "",
  );
  const words = text.split(" ").filter(Boolean).slice(0, 8).join(" ");
  const trimmed =
    words.length > 60 ? `${words.slice(0, 57).trimEnd()}…` : words;
  if (!trimmed) return "New task";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Deterministic draft for when the draft model returns nothing usable.
 * Keeps the create flow working (and is unit-tested) instead of surfacing
 * "The model did not return a draft." to the user.
 */
export function draftFromInstructions(
  prompt: string,
  opts?: DraftOptions,
): TaskDraft {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  const draft: TaskDraft = {
    name: titleFromInstructions(text),
    instructions: text || "Task created from an empty request.",
    scheduleKind: "once",
  };

  const explicitEvery = /every\s+(\d+)\s*(minute|min|hour|hr|day|week|month)s?/.exec(lower);
  const daily = /\b(daily|every day|each day|every morning|each morning|every evening)\b/.test(lower);
  const weekly = /\b(weekly|every week|each week)\b/.test(lower);
  const monthly = /\b(monthly|every month|each month)\b/.test(lower);
  const hourly = /\b(hourly|every hour|each hour)\b/.test(lower);
  // Only treat "2" as a time when it is "2pm"/"2:30" or follows "at";
  // otherwise "every day buy 2 apples" would schedule the wrong hour.
  const clock =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(lower) ??
    /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i.exec(lower);
  let hour: number | undefined;
  let minute: number | undefined;
  if (clock) {
    let h = Number(clock[1]);
    const m = clock[2] ? Number(clock[2]) : 0;
    const meridiem = clock[3]?.toLowerCase();
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hour = h;
      minute = m;
    }
  }

  if (explicitEvery) {
    const amount = Number(explicitEvery[1]) || 1;
    const unit = explicitEvery[2];
    const minutes =
      unit.startsWith("min") ? amount
        : unit.startsWith("h") ? amount * 60
          : unit.startsWith("day") ? amount * 1440
            : unit.startsWith("week") ? amount * 10_080
              : amount * 43_200;
    draft.scheduleKind = "interval";
    draft.intervalMinutes = Math.max(1, Math.round(minutes));
    if (hour !== undefined) {
      draft.hour = hour;
      draft.minute = minute ?? 0;
    }
    return draft;
  }

  if (daily || weekly || monthly || hourly) {
    draft.scheduleKind = "interval";
    draft.intervalMinutes = daily ? 1440 : weekly ? 10_080 : monthly ? 43_200 : 60;
    if (daily || weekly) {
      draft.hour = hour ?? 9;
      draft.minute = minute ?? 0;
    }
    return draft;
  }

  // A reminder with no explicit timing is a manual to-do when allowed,
  // otherwise run once at the next full hour.
  if (opts?.allowManual === true) {
    draft.scheduleKind = "none";
    return draft;
  }
  const next = new Date(Date.now() + 3_600_000);
  next.setMinutes(0, 0, 0);
  draft.scheduleKind = "once";
  draft.runAt = next.toISOString();
  return draft;
}

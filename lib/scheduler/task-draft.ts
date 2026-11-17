/** System prompt for the title-only helper used when the title is left blank. */
export function buildTitleSystemPrompt(): string {
  return [
    "Give a short, concrete title for a task reminder.",
    'Reply with ONE JSON object only: {"name": string}.',
    "The name must be 3-60 characters, title case, and describe the action — never a generic label like 'Task' or 'Reminder'.",
  ].join(" ");
}

/** The only input for title generation is the instructions text itself. */
export function buildTitlePrompt(instructions: string): string {
  return `Reminder instructions:\n${instructions.trim().slice(0, 4000)}`;
}

export type ValidateTitleResult = { ok: true; name: string } | { ok: false; error: string };

function parseName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 120) : "";
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

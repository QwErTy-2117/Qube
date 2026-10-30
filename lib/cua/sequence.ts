/**
 * Legacy `computer_run_sequence` translation helpers.
 *
 * The previous ocu integration required observe+act in a single process and
 * exposed a `{calls:[{tool,args}]}` sequence. We keep that model-facing
 * surface (and its element_index semantics) and translate it to CUA Driver's
 * `run_steps` batches. These helpers are pure so the translation is tested
 * without a desktop.
 */

import type { CuaActionTool } from "./config";

export const LEGACY_SEQUENCE_TOOLS = [
  "list_apps",
  "get_app_state",
  "click",
  "perform_secondary_action",
  "right_click",
  "double_click",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "hotkey",
  "set_value",
  "list_windows",
  "get_window",
  "get_window_state",
  "get_desktop_state",
  "launch_app",
  "activate_window",
] as const;

export type LegacySequenceTool = (typeof LEGACY_SEQUENCE_TOOLS)[number];

export type LegacySequenceCall = {
  tool: LegacySequenceTool | string;
  args: Record<string, unknown>;
};

export type SequenceValidation =
  | { ok: true; calls: LegacySequenceCall[] }
  | { ok: false; error: string };

const LEGACY_SET = new Set<string>(LEGACY_SEQUENCE_TOOLS);

const OBSERVATION_TOOLS = new Set([
  "list_apps",
  "get_app_state",
  "list_windows",
  "get_window",
  "get_window_state",
  "get_desktop_state",
]);

const IMMEDIATE_TOOLS = new Set(["launch_app", "activate_window"]);

const ACTION_MAP: Record<string, CuaActionTool> = {
  click: "click",
  double_click: "double_click",
  perform_secondary_action: "right_click",
  right_click: "right_click",
  scroll: "scroll",
  drag: "drag",
  type_text: "type_text",
  press_key: "press_key",
  hotkey: "hotkey",
  set_value: "set_value",
};

/** Validate/normalize the legacy `calls` array before any driver call. */
export function validateSequenceCalls(calls: unknown): SequenceValidation {
  if (!Array.isArray(calls) || calls.length === 0) {
    return { ok: false, error: "calls must be a non-empty array of {tool,args} steps." };
  }
  if (calls.length > 16) {
    return { ok: false, error: "A sequence may contain at most 16 steps." };
  }
  const out: LegacySequenceCall[] = [];
  for (const [index, raw] of calls.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `Sequence step ${index} must be an object with tool and args.` };
    }
    const call = raw as Record<string, unknown>;
    const tool = typeof call.tool === "string" ? call.tool.trim() : "";
    if (!tool || !LEGACY_SET.has(tool)) {
      return {
        ok: false,
        error: `Sequence step ${index} has unknown tool "${tool}". Valid: ${LEGACY_SEQUENCE_TOOLS.join(", ")}.`,
      };
    }
    if (!call.args || typeof call.args !== "object" || Array.isArray(call.args)) {
      return { ok: false, error: `Sequence step ${index} (${tool}) needs an args object.` };
    }
    out.push({ tool, args: { ...(call.args as Record<string, unknown>) } });
  }
  return { ok: true, calls: out };
}

export function isLegacyObservationTool(tool: string): boolean {
  return OBSERVATION_TOOLS.has(tool);
}

export function isLegacyImmediateTool(tool: string): boolean {
  return IMMEDIATE_TOOLS.has(tool);
}

export function legacyActionTool(tool: string): CuaActionTool | null {
  return ACTION_MAP[tool] ?? null;
}

/** Accept an old element_index (string like "12" or "[12]") or a number. */
export function normalizeElementIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const m = /(\d+)/.exec(value);
    if (m) {
      const n = Number(m[1]);
      return Number.isInteger(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
  opt: "alt",
  cmd: "super",
  command: "super",
  meta: "super",
  super: "super",
  win: "super",
  windows: "super",
};

function normalizeKeyName(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return "";
  if (key === " " || key === "spacebar") return "space";
  if (key === "esc") return "escape";
  if (key === "return") return "enter";
  if (/^page[\s_-]?up$/.test(key)) return "pageup";
  if (/^page[\s_-]?down$/.test(key)) return "pagedown";
  if (/^f([1-9]|1[0-2])$/.test(key)) return key;
  if (["enter", "tab", "escape", "space", "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "up", "down", "left", "right"].includes(key)) {
    return key;
  }
  return key.length === 1 ? key : key.replace(/[\s_-]+/g, "");
}

/**
 * Parse "ctrl+shift+t" / "cmd+s" / "page_up" into CUA press_key/hotkey
 * arguments. Unknown names are preserved (the driver returns a clear error).
 */
export function parseKeyChord(input: string): { key: string; modifiers: string[] } {
  const raw = String(input || "").trim();
  if (!raw) return { key: "", modifiers: [] };
  if (raw === " " || raw === "space") return { key: "space", modifiers: [] };
  const parts = raw.split("+").map((part) => part.trim()).filter((part) => part.length > 0);
  const modifiers: string[] = [];
  let key = "";
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
    } else {
      key = part;
    }
  }
  return { key: normalizeKeyName(key), modifiers };
}

/**
 * Map legacy scroll args (direction/pages/delta_x/delta_y/element_index) to
 * CUA's {direction, amount, by}. Positive delta = down/right (wheel deltas).
 */
export function scrollFromLegacy(args: Record<string, unknown>): {
  direction: "up" | "down" | "left" | "right";
  amount: number;
  by: "line" | "page";
} {
  const dx = Number(args.delta_x ?? args.deltaX ?? NaN);
  const dy = Number(args.delta_y ?? args.deltaY ?? NaN);
  const rawDirection = String(args.direction ?? "").toLowerCase();
  let direction: "up" | "down" | "left" | "right" = "down";
  if (rawDirection === "up" || rawDirection === "down" || rawDirection === "left" || rawDirection === "right") {
    direction = rawDirection;
  } else if (Number.isFinite(dx) && Math.abs(dx) > Math.abs(Number.isFinite(dy) ? dy : 0)) {
    direction = dx < 0 ? "left" : "right";
  } else if (Number.isFinite(dy)) {
    direction = dy < 0 ? "up" : "down";
  }

  const pages = Number(args.pages ?? NaN);
  if (Number.isFinite(pages) && pages > 0) {
    return { direction, amount: Math.min(50, Math.max(1, Math.round(pages))), by: "page" };
  }

  const delta = direction === "left" || direction === "right" ? dx : dy;
  if (Number.isFinite(delta) && delta !== 0) {
    return { direction, amount: Math.min(50, Math.max(1, Math.round(Math.abs(delta) / 120))), by: "line" };
  }

  const amount = Number(args.amount ?? NaN);
  if (Number.isFinite(amount) && amount > 0) {
    return {
      direction,
      amount: Math.min(50, Math.max(1, Math.round(amount))),
      by: args.by === "page" ? "page" : "line",
    };
  }
  return { direction, amount: 3, by: args.by === "page" ? "page" : "line" };
}

/** Map the many old drag spellings to CUA's from/to pixel coordinates. */
export function dragFromLegacy(args: Record<string, unknown>): {
  from_x: number;
  from_y: number;
  to_x: number;
  to_y: number;
} | null {
  const num = (...keys: string[]): number | null => {
    for (const key of keys) {
      const n = Number(args[key]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const fromX = num("from_x", "start_x", "x1", "x");
  const fromY = num("from_y", "start_y", "y1", "y");
  const toX = num("to_x", "end_x", "x2");
  const toY = num("to_y", "end_y", "y2");
  if (fromX === null || fromY === null || toX === null || toY === null) return null;
  return { from_x: fromX, from_y: fromY, to_x: toX, to_y: toY };
}

export type CuaSequenceStep = {
  tool: string;
  args: Record<string, unknown>;
  wait_for?: Record<string, unknown>;
  expect?: Array<Record<string, unknown>>;
  timeout_ms?: number;
};

/**
 * Translate one legacy action step to a CUA run_steps step. Token resolution
 * happens in the service (it needs the window snapshot cache); this function
 * only maps the static argument names.
 */
export function translateLegacyAction(
  tool: string,
  args: Record<string, unknown>,
  resolvedToken?: string | null,
): CuaSequenceStep {
  const base: Record<string, unknown> = {};
  if (resolvedToken) base.element_token = resolvedToken;
  if (typeof args.delivery_mode === "string") base.delivery_mode = args.delivery_mode;
  if (args.scope === "desktop") base.scope = "desktop";
  if (args.coordinate_frame === "desktop") base.coordinate_frame = "desktop";
  if (Array.isArray(args.modifier)) base.modifier = args.modifier;
  if (Array.isArray(args.modifiers)) {
    // CUA press_key uses `modifiers`, click uses `modifier`; keep both only
    // for tools that actually declare them.
  }

  const x = Number(args.x);
  const y = Number(args.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    base.x = x;
    base.y = y;
  }

  if (tool === "click" || tool === "double_click" || tool === "right_click" || tool === "perform_secondary_action") {
    const target = tool === "perform_secondary_action" ? "right_click" : tool;
    if (target === "click") {
      const count = Number(args.count ?? 1);
      if (Number.isFinite(count) && count > 1) base.count = Math.min(3, Math.max(1, Math.round(count)));
      if (typeof args.button === "string") base.button = args.button;
    } else {
      // CUA's double_click/right_click have no count/button fields.
      delete base.count;
      delete base.button;
    }
    return { tool: target, args: base };
  }

  if (tool === "scroll") {
    const scroll = scrollFromLegacy(args);
    const { modifier: _m, ...scrollBase } = base;
    void _m;
    return {
      tool: "scroll",
      args: { ...scrollBase, direction: scroll.direction, amount: scroll.amount, by: scroll.by },
    };
  }

  if (tool === "drag") {
    const drag = dragFromLegacy(args);
    if (!drag) {
      throw new Error(
        "drag needs from_x/from_y + to_x/to_y (or start_x/start_y + end_x/end_y) window-local screenshot pixels.",
      );
    }
    // drag has no element_token or x/y fields; it is purely from → to pixels.
    const { element_token: _token, x: _x, y: _y, ...dragBase } = base;
    void _token;
    void _x;
    void _y;
    return {
      tool: "drag",
      args: {
        ...dragBase,
        ...drag,
        ...(Number.isFinite(Number(args.duration_ms))
          ? { duration_ms: Math.min(10000, Math.max(0, Number(args.duration_ms))) }
          : {}),
      },
    };
  }

  if (tool === "type_text") {
    const text = String(args.text ?? "");
    if (!text) throw new Error("type_text needs a non-empty text value.");
    const { modifier: _m, ...typeBase } = base;
    void _m;
    return { tool: "type_text", args: { ...typeBase, text: text.slice(0, 100000) } };
  }

  if (tool === "press_key" || tool === "hotkey") {
    const keys = Array.isArray(args.keys)
      ? args.keys.map((k) => String(k)).filter(Boolean)
      : null;
    if (keys && keys.length >= 2) {
      const { modifier: _m, ...keyBase } = base;
      void _m;
      return { tool: "hotkey", args: { ...keyBase, keys } };
    }
    const chord = parseKeyChord(String(args.key ?? (keys && keys.length === 1 ? keys[0] : "")));
    if (!chord.key) throw new Error(`${tool} needs a key, e.g. "return" or "ctrl+s".`);
    const extraModifiers = Array.isArray(args.modifiers)
      ? args.modifiers.map((m) => String(m))
      : [];
    const modifiers = [...new Set([...chord.modifiers, ...extraModifiers])];
    // hotkey has no `modifiers` field (keys carry the chord); press_key does.
    const { modifier: _m, ...keyBase } = base;
    void _m;
    if (modifiers.length > 0) {
      return { tool: "hotkey", args: { ...keyBase, keys: [...modifiers, chord.key] } };
    }
    return {
      tool: "press_key",
      args: { ...keyBase, key: chord.key, ...(extraModifiers.length ? { modifiers: extraModifiers } : {}) },
    };
  }

  if (tool === "set_value") {
    const value = String(args.value ?? "");
    if (!resolvedToken) throw new Error("set_value needs an element_index/element_token from a fresh app state.");
    const {
      x: _x,
      y: _y,
      modifier: _m,
      scope: _scope,
      coordinate_frame: _cf,
      ...setBase
    } = base;
    void _x;
    void _y;
    void _m;
    void _scope;
    void _cf;
    return { tool: "set_value", args: { ...setBase, value } };
  }

  throw new Error(`Unsupported action tool "${tool}".`);
}

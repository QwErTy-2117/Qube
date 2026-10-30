/**
 * CUA Driver configuration + naming.
 *
 * Computer Use is implemented on top of trycua/cua's CUA Driver. Qube talks
 * to the local CUA Driver daemon through its CLI (`cua-driver call …`), which
 * gives us typed MCP tools, a stable named session, screenshots, batching and
 * the native cinematic agent cursor.
 *
 * Everything here is pure/cheap so it can be unit-tested without a display or
 * a running daemon.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const COMPUTER_USE_DISABLED_ENV = "COMPUTER_USE_DISABLED";
export const CUA_DRIVER_COMMAND_ENV = "CUA_DRIVER_COMMAND";
/** Backwards-compatible alias for the old ocu integration. */
export const LEGACY_COMPUTER_USE_COMMAND_ENV = "COMPUTER_USE_COMMAND";
export const CUA_DRIVER_TIMEOUT_ENV = "COMPUTER_USE_TIMEOUT_MS";
export const CUA_DRIVER_START_TIMEOUT_ENV = "CUA_DRIVER_START_TIMEOUT_MS";
export const CUA_DRIVER_AUTOSTART_ENV = "CUA_DRIVER_AUTOSTART";

export const CUA_DRIVER_INSTALL_HINT =
  "Computer Use needs CUA Driver. Install it once with `curl -fsSL https://cua.ai/driver/install.sh | bash` " +
  "(or download a release from https://github.com/trycua/cua), then run `cua-driver doctor`. " +
  "Qube starts the local daemon automatically. Set COMPUTER_USE_DISABLED=1 to turn computer control off.";

export const CUA_PERMISSIONS_HINT =
  "Grant CUA Driver Accessibility + Screen Recording on macOS (System Settings → Privacy & Security), " +
  "then run `cua-driver doctor` and retry. On Linux, make sure Qube runs inside your graphical desktop session.";

/** Native CUA Driver action tools used by the Qube wrappers. */
export const CUA_ACTION_TOOLS = [
  "click",
  "double_click",
  "right_click",
  "set_value",
  "type_text",
  "press_key",
  "hotkey",
  "scroll",
  "drag",
  "move_cursor",
] as const;

export type CuaActionTool = (typeof CUA_ACTION_TOOLS)[number];

/** Qube-facing tools kept from the previous integration (plus CUA additions). */
export const QUBE_COMPUTER_TOOLS = [
  "computer_list_apps",
  "computer_get_app_state",
  "computer_click",
  "computer_secondary_action",
  "computer_scroll",
  "computer_drag",
  "computer_type_text",
  "computer_press_key",
  "computer_set_value",
  "computer_launch_app",
  "computer_activate_window",
  "computer_doctor",
  "computer_clipboard_read",
  "computer_clipboard_write",
  "computer_capabilities",
  "computer_run_sequence",
  "computer_list_windows",
  "computer_get_window",
  "computer_get_window_state",
  "computer_get_desktop_state",
] as const;

export type QubeComputerTool = (typeof QUBE_COMPUTER_TOOLS)[number];

/** Read-only tools never pause for approval (and may run in background). */
export const CUA_READ_ONLY_QUBE_TOOLS: ReadonlySet<string> = new Set([
  "computer_list_apps",
  "computer_get_app_state",
  "computer_list_windows",
  "computer_get_window",
  "computer_get_window_state",
  "computer_get_desktop_state",
  "computer_doctor",
  "computer_capabilities",
  "computer_clipboard_read",
]);

/** Qube tool name → CUA Driver tool name (where the mapping is 1:1). */
export const QUBE_TO_CUA_TOOL: Record<string, string> = {
  computer_list_apps: "list_apps",
  computer_list_windows: "list_windows",
  computer_get_app_state: "get_window_state",
  computer_get_window_state: "get_window_state",
  computer_get_window: "list_windows",
  computer_get_desktop_state: "get_desktop_state",
  computer_launch_app: "launch_app",
  computer_activate_window: "bring_to_front",
  computer_click: "click",
  computer_secondary_action: "right_click",
  computer_scroll: "scroll",
  computer_drag: "drag",
  computer_type_text: "type_text",
  computer_press_key: "press_key",
  computer_set_value: "set_value",
  computer_clipboard_read: "clipboard_read",
  computer_clipboard_write: "clipboard_write",
};

const CUA_TO_QUBE_TOOL: Record<string, string> = Object.fromEntries(
  Object.entries(QUBE_TO_CUA_TOOL).map(([qube, cua]) => [cua, qube]),
);

export function qubeComputerToolName(cuaTool: string): string {
  return CUA_TO_QUBE_TOOL[cuaTool] ?? `computer_${cuaTool}`;
}

export function cuaToolFromQubeTool(qubeTool: string): string | null {
  return QUBE_TO_CUA_TOOL[qubeTool] ?? null;
}

export function isReadOnlyComputerTool(qubeTool: string): boolean {
  return CUA_READ_ONLY_QUBE_TOOLS.has(qubeTool);
}

export function isComputerUseDisabled(): boolean {
  return process.env[COMPUTER_USE_DISABLED_ENV] === "1";
}

export function cuaDriverAutoStart(): boolean {
  const raw = (process.env[CUA_DRIVER_AUTOSTART_ENV] ?? "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export function cuaDriverTimeoutMs(): number {
  const raw = Number(process.env[CUA_DRIVER_TIMEOUT_ENV] ?? 60000);
  return Number.isFinite(raw) && raw >= 5000 && raw <= 300000 ? Math.round(raw) : 60000;
}

export function cuaDriverStartTimeoutMs(): number {
  const raw = Number(process.env[CUA_DRIVER_START_TIMEOUT_ENV] ?? 15000);
  return Number.isFinite(raw) && raw >= 2000 && raw <= 120000 ? Math.round(raw) : 15000;
}

function unquote(token: string): string {
  const t = token.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Resolve the CUA Driver executable.
 *
 * The installer puts the binary in `~/.local/bin` (not always on PATH) and
 * keeps the versioned release under `~/.cua-driver`. Absolute candidates are
 * checked first so Qube works even when the desktop app inherits a PATH that
 * does not include the installer directory.
 */
export function resolveCuaDriverCommand(): {
  command: string;
  extraArgs: string[];
  source: "env" | "absolute" | "path";
  available: boolean;
} {
  const raw =
    (process.env[CUA_DRIVER_COMMAND_ENV] || process.env[LEGACY_COMPUTER_USE_COMMAND_ENV] || "").trim();
  if (raw) {
    // Allow a full command line while preserving quoted paths (e.g. a Qube
    // checkout under "/home/me/Projects/my app").
    if (existsSync(raw)) return { command: raw, extraArgs: [], source: "env", available: true };
    const tokens = (raw.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(unquote).filter(Boolean);
    const command = tokens[0] || raw;
    return {
      command,
      extraArgs: tokens.slice(1),
      source: "env",
      available: !command.includes("/") && !command.includes("\\") ? true : existsSync(command),
    };
  }

  const home = (() => {
    try {
      return homedir();
    } catch {
      return "";
    }
  })();
  const exe = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const candidates = [
    home ? join(home, ".local", "bin", exe) : "",
    home ? join(home, ".cua-driver", "packages", "current", exe) : "",
    process.platform === "darwin" ? "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" : "",
    "/usr/local/bin/cua-driver",
    "/opt/homebrew/bin/cua-driver",
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "CuaDriver", exe)
      : "",
    process.platform === "win32" && process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "CuaDriver", exe)
      : "",
    join(process.cwd(), "node_modules", ".bin", exe),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return { command: candidate, extraArgs: [], source: "absolute", available: true };
      }
    } catch {}
  }

  // Bare command: PATH is resolved by the OS at exec time. Availability is
  // proven by the first spawn (missing → install hint).
  return { command: exe, extraArgs: [], source: "path", available: true };
}

export function missingBinaryError(tool = "computer_use"): string {
  return JSON.stringify({
    error: true,
    tool,
    message: CUA_DRIVER_INSTALL_HINT,
    hint: "Install CUA Driver, then retry. Read-only checks like computer_doctor also require the driver.",
  });
}

/**
 * Stable, short session label. CUA keeps the native cursor + lifecycle state
 * per session; reusing one label per chat thread keeps the agent cursor alive
 * between tool calls and runs.
 */
export function cuaSessionLabel(threadId: string): string {
  const cleaned = String(threadId || "thread")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "thread";
  const hash = createHash("sha1").update(String(threadId || "thread")).digest("hex").slice(0, 6);
  return `qube-${cleaned}-${hash}`;
}

export type CuaCursorMotion = {
  style: string;
  timing: string;
  effects: Record<"trail" | "glow" | "magnet" | "ripple" | "squish", "on" | "off">;
  idle_hide_ms: number;
  dwell_after_click_ms: number;
  arc_size: number;
  arc_flow: number;
  start_handle: number;
  end_handle: number;
};

function envString(name: string, fallback: string): string {
  const raw = (process.env[name] || "").trim();
  return raw || fallback;
}

/**
 * Native cinematic agent cursor configuration. `adaptive` + `fitts` uses a
 * careful, human-like approach for small targets and a longer swoop for long
 * travels; effects add the visible trail/ripple/click feedback. idle_hide_ms
 * is 0 so the cursor never fades while the agent is working.
 */
export function cuaCursorMotionConfig(): CuaCursorMotion {
  const style = envString("CUA_CURSOR_STYLE", "adaptive");
  const timing = envString("CUA_CURSOR_TIMING", "fitts");
  const rawEffects = envString("CUA_CURSOR_EFFECTS", "trail,glow,magnet,ripple,squish").toLowerCase();
  const off = rawEffects === "off" || rawEffects === "none" || rawEffects === "0";
  const enabled = new Set(
    off ? [] : rawEffects.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
  );
  const effect = (name: string): "on" | "off" => {
    if (off) return "off";
    return enabled.size === 0 || enabled.has(name) ? "on" : "off";
  };
  const idleRaw = Number(process.env.CUA_CURSOR_IDLE_HIDE_MS ?? 0);
  const idle = Number.isFinite(idleRaw) && idleRaw >= 0 ? Math.min(600000, Math.round(idleRaw)) : 0;
  return {
    style,
    timing,
    effects: {
      trail: effect("trail"),
      glow: effect("glow"),
      magnet: effect("magnet"),
      ripple: effect("ripple"),
      squish: effect("squish"),
    },
    idle_hide_ms: idle,
    dwell_after_click_ms: 90,
    arc_size: 0.25,
    arc_flow: 0.1,
    start_handle: 0.3,
    end_handle: 0.3,
  };
}

/** True when a computer tool is in the read-only set (no approval pause). */
export function isReadOnlyComputerName(qubeTool: string): boolean {
  return CUA_READ_ONLY_QUBE_TOOLS.has(qubeTool);
}

/**
 * Built-in Computer Use — OS-level control via open-codex-computer-use
 * (https://github.com/iFurySt/open-codex-computer-use) through the `ocu`
 * / `open-computer-use` CLI.
 *
 * Qube wraps the 9 core ocu tools with a `computer_` prefix to avoid
 * collisions with the managed-browser tools (browser_* + obu click/type/
 * press_key/…). Native wrapper (exec `ocu call …`) is preferred over a raw
 * MCP stdio server: no daemon lifecycle, explicit Zod schemas, permission
 * gating per tool, and clear install hints when the binary is missing.
 *
 * Override via env: COMPUTER_USE_DISABLED=1, COMPUTER_USE_COMMAND,
 * COMPUTER_USE_TIMEOUT_MS.
 */

import { existsSync } from "node:fs";

export const COMPUTER_USE_SERVER_ID = "qube-computer-use";
export const COMPUTER_USE_DISABLED_ENV = "COMPUTER_USE_DISABLED";

/** Core ocu tools (identical across macOS/Linux/Windows). */
export const COMPUTER_USE_OCU_TOOLS = [
  "list_apps",
  "get_app_state",
  "click",
  "perform_secondary_action",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "set_value",
] as const;

/** Window-level tools (Windows today, macOS/Linux in progress upstream). */
export const COMPUTER_USE_WINDOW_TOOLS = [
  "list_windows",
  "get_window",
  "get_window_state",
  "launch_app",
  "activate_window",
] as const;

/** Qube-facing names: every ocu tool gets a `computer_` prefix. */
export function qubeComputerToolName(ocuTool: string): string {
  return `computer_${ocuTool}`;
}

export function ocuToolFromQubeTool(qubeTool: string): string | null {
  if (!qubeTool.startsWith("computer_")) return null;
  const base = qubeTool.slice("computer_".length);
  const known = new Set<string>([...COMPUTER_USE_OCU_TOOLS, ...COMPUTER_USE_WINDOW_TOOLS]);
  return known.has(base) ? base : null;
}

/** Read-only ocu tools: never pause for approval. */
export function isReadOnlyComputerTool(qubeTool: string): boolean {
  return (
    qubeTool === "computer_list_apps" ||
    qubeTool === "computer_get_app_state" ||
    qubeTool === "computer_list_windows" ||
    qubeTool === "computer_get_window" ||
    qubeTool === "computer_get_window_state" ||
    qubeTool === "computer_doctor" ||
    qubeTool === "computer_clipboard_read" ||
    qubeTool === "computer_capabilities"
  );
}

export function isComputerUseDisabled(): boolean {
  return process.env[COMPUTER_USE_DISABLED_ENV] === "1";
}

function resolveCommand(): string {
  const raw = (process.env.COMPUTER_USE_COMMAND || "").trim();
  if (raw) {
    // Allow full command lines ("npx -y open-computer-use call") — first
    // token is the binary, rest is folded into args by the caller.
    return raw.split(/\s+/)[0];
  }
  // Prefer short alias, fall back to full name at exec time.
  return "ocu";
}

function resolveCommandExtraArgs(): string[] {
  const raw = (process.env.COMPUTER_USE_COMMAND || "").trim();
  if (!raw) return [];
  const parts = raw.split(/\s+/).slice(1);
  return parts;
}

export function resolveComputerCommand(): { command: string; extraArgs: string[] } {
  return { command: resolveCommand(), extraArgs: resolveCommandExtraArgs() };
}

export function computerUseTimeoutMs(): number {
  const raw = Number(process.env.COMPUTER_USE_TIMEOUT_MS ?? 60000);
  return Number.isFinite(raw) && raw >= 5000 && raw <= 300000 ? raw : 60000;
}

export const COMPUTER_USE_INSTALL_HINT =
  "Computer Use is not installed. Install it once with `npm i -g open-computer-use` (provides `ocu` + `open-computer-use`), then run `ocu doctor` to grant Accessibility + Screen Recording on macOS, and retry. Set COMPUTER_USE_DISABLED=1 to silence.";

export function missingBinaryError(): string {
  return JSON.stringify({
    error: true,
    tool: "computer_use",
    message: COMPUTER_USE_INSTALL_HINT,
  });
}

/**
 * Check whether an ocu binary is reachable (best-effort, no spawn when the
 * env override points at an absolute path that does not exist).
 */
export function computerBinaryAvailable(): boolean {
  if (isComputerUseDisabled()) return false;
  const { command } = resolveComputerCommand();
  if (command.includes("/") || command.includes("\\")) {
    try {
      return existsSync(command);
    } catch {
      return false;
    }
  }
  // Bare command (ocu / open-computer-use / npx): availability is proven at
  // exec time so we report true and let the tool return the install hint.
  return true;
}

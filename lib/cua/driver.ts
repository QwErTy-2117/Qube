/**
 * CUA Driver CLI transport.
 *
 * We intentionally integrate through the documented `cua-driver` CLI rather
 * than linking the native SDK: no native addon in the Next server bundle, and
 * the same typed MCP tools / sessions / screenshots that CUA exposes to every
 * other client.
 *
 * The driver auto-starts the local daemon on first use (bounded readiness
 * poll) and normalizes both the CLI's structuredContent output and MCP-style
 * `{content, isError}` results into one shape.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  CUA_DRIVER_INSTALL_HINT,
  CUA_PERMISSIONS_HINT,
  cuaDriverAutoStart,
  cuaDriverStartTimeoutMs,
  cuaDriverTimeoutMs,
  isComputerUseDisabled,
  missingBinaryError,
  resolveCuaDriverCommand,
} from "./config";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 32 * 1024 * 1024;

export type ParsedCuaOutput = {
  data: Record<string, unknown> | null;
  text: string;
  raw: string;
  isError: boolean;
  screenshotBase64?: string;
  screenshotMime?: string;
};

export type CuaCallOptions = {
  timeoutMs?: number;
  screenshotOutFile?: string;
  signal?: AbortSignal;
};

export type CuaCliResult = {
  raw: string;
  stdout: string;
  stderr: string;
  code: number;
};

export class CuaDriverError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(message: string, code = "cua_error", hint?: string, details?: unknown) {
    super(message);
    this.name = "CuaDriverError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export class CuaToolError extends CuaDriverError {
  readonly parsed: ParsedCuaOutput;

  constructor(tool: string, parsed: ParsedCuaOutput) {
    const info = translateCuaFailure(
      errorMessageFrom(parsed.data, parsed.text),
      parsed.data,
    );
    super(
      info.message || `CUA tool "${tool}" failed.`,
      info.code,
      info.hint,
      parsed.data,
    );
    this.name = "CuaToolError";
    this.parsed = parsed;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Normalize one `cua-driver call` stdout payload. The CLI prints
 * structuredContent when the tool has it (most tools), otherwise the MCP
 * content text. Both are handled, plus the merged screenshot base64 form.
 */
export function parseCuaOutput(raw: string): ParsedCuaOutput {
  const source = String(raw ?? "").trim();
  if (!source) {
    return { data: null, text: "", raw: source, isError: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { data: null, text: source, raw: source, isError: false };
  }

  const root = asRecord(parsed);
  if (!root) {
    return { data: null, text: source, raw: source, isError: false };
  }

  const content = Array.isArray(root.content) ? root.content : null;
  const contentText = content
    ? content
        .map((part) => (asRecord(part)?.type === "text" ? String(asRecord(part)?.text ?? "") : ""))
        .filter(Boolean)
        .join("\n")
    : "";
  const structured = asRecord(root.structuredContent) ?? asRecord(root.result);
  const data = structured ?? root;

  const screenshotBase64 =
    typeof data.screenshot_png_b64 === "string"
      ? data.screenshot_png_b64
      : typeof root.screenshot_png_b64 === "string"
        ? root.screenshot_png_b64
        : undefined;
  const screenshotMime =
    typeof data.screenshot_mime_type === "string"
      ? data.screenshot_mime_type
      : typeof root.screenshot_mime_type === "string"
        ? root.screenshot_mime_type
        : screenshotBase64
          ? "image/png"
          : undefined;

  const text =
    (typeof data.tree_markdown === "string" && data.tree_markdown) ||
    (typeof data.text === "string" && data.text) ||
    contentText;

  const isError =
    root.isError === true ||
    data.isError === true ||
    data.ok === false ||
    (data.error !== undefined && data.error !== false && data.error !== null) ||
    (root.error !== undefined && root.error !== false && root.error !== null);

  return {
    data,
    text,
    raw: source,
    isError,
    screenshotBase64,
    screenshotMime,
  };
}

export function errorMessageFrom(
  data: Record<string, unknown> | null,
  fallback = "",
): string {
  if (data) {
    const err = data.error;
    if (typeof err === "string" && err.trim()) return err.trim();
    const errObj = asRecord(err);
    if (errObj) {
      for (const key of ["message", "detail", "reason", "error"]) {
        const v = errObj[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    for (const key of ["message", "detail", "reason", "error_text"]) {
      const v = data[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return String(fallback || "").trim();
}

function errorCodeFrom(data: Record<string, unknown> | null): string {
  if (!data) return "";
  const errObj = asRecord(data.error);
  const raw =
    (typeof data.code === "string" && data.code) ||
    (typeof data.kind === "string" && data.kind) ||
    (errObj && typeof errObj.code === "string" && errObj.code) ||
    "";
  return raw.trim();
}

function errorHintFrom(data: Record<string, unknown> | null): string {
  if (!data) return "";
  const errObj = asRecord(data.error);
  const raw =
    (typeof data.hint === "string" && data.hint) ||
    (errObj && typeof errObj.hint === "string" && errObj.hint) ||
    "";
  return raw.trim();
}

/**
 * Turn cryptic driver/tool failures into actionable guidance. Kept pure so
 * error paths are unit-tested without a desktop.
 */
export function translateCuaFailure(
  message: string,
  data: Record<string, unknown> | null = null,
): { code: string; message: string; hint?: string } {
  const msg = String(message || "").trim();
  const lower = msg.toLowerCase();
  const explicitCode = errorCodeFrom(data);
  const explicitHint = errorHintFrom(data);

  const make = (code: string, hint: string) => ({
    code,
    message: msg || "CUA Driver reported an error.",
    hint: explicitHint || hint,
  });

  if (explicitCode === "background_unavailable" || /background[_ ]unavailable|ignores background|does not accept background/.test(lower)) {
    return make(
      "background_unavailable",
      "The app ignores background input. Retry once with delivery_mode:\"foreground\" (the window is activated briefly), or bring it to the front with computer_activate_window first.",
    );
  }
  if (/stale|snapshot.*(expired|superseded|invalidated)|invalidated_snapshot/.test(lower)) {
    return make(
      "stale_snapshot",
      "That element token/snapshot is stale. Run computer_get_app_state for the same app to get a fresh snapshot, then retry once using the new element_index or element_token.",
    );
  }
  if (/element.*(not found|missing)|no element|target.*not found/.test(lower)) {
    return make(
      "element_not_found",
      "The target element was not found. Re-run computer_get_app_state (or target by role/name inside computer_run_sequence) and retry once.",
    );
  }
  if (/app.*not found|no such app|appnotfound|window.*not found|no window|no windows|not running/.test(lower)) {
    return make(
      "target_not_found",
      "The app/window is not available. Run computer_list_apps / computer_list_windows for exact names and ids; launch the app first if it is not running.",
    );
  }
  if (/accessibility|screen recording|not authorized|permission denied|permission|tcc/.test(lower)) {
    return make("permissions", CUA_PERMISSIONS_HINT);
  }
  if (/\$display|wayland_display|no display|display server|capture error/.test(lower)) {
    return make(
      "no_display",
      "No graphical desktop is available to the Qube process. Run Qube inside the user's graphical session (with DISPLAY or WAYLAND_DISPLAY) and retry.",
    );
  }
  if (/timed? ?out|timeout|deadline exceeded/.test(lower)) {
    return make(
      "timeout",
      "The driver timed out. Re-run computer_get_app_state for a fresh state, then retry once with a simpler action. Do not replay uncertain actions blindly.",
    );
  }
  if (/daemon is not running|daemon.*(unavailable|not reachable)|socket.*(missing|refused)|failed to connect/.test(lower)) {
    return make(
      "daemon_unavailable",
      "The CUA Driver daemon is not reachable. Qube starts it automatically; run `cua-driver serve` in a terminal and retry, then `cua-driver doctor` if it still fails.",
    );
  }
  if (/unsupported|not supported/.test(lower)) {
    return make(
      "unsupported",
      "This CUA Driver/toolkit combination does not support that action. Switch methods (element target ↔ coordinates ↔ keyboard) or use the closest workspace/browser tool.",
    );
  }
  return {
    code: explicitCode || "cua_error",
    message: msg || "CUA Driver reported an error.",
    hint: explicitHint || "Inspect the app state with computer_get_app_state, then retry once with a different target or method.",
  };
}

function parseToolError(tool: string, raw: string): CuaToolError | null {
  if (!raw.trim()) return null;
  try {
    const parsed = parseCuaOutput(raw);
    if (parsed.isError) return new CuaToolError(tool, parsed);
  } catch {}
  return null;
}

function looksLikeDaemonDown(raw: string): boolean {
  return /daemon is not running|no such file or directory.*\.sock|connection refused/i.test(raw);
}

/** Pixel dimensions from a PNG header (no image library needed). */
export function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    if (buffer.length < 24) return null;
    const signature = buffer.subarray(0, 8);
    if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
    // IHDR width/height are big-endian at byte offsets 16 and 20.
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

let daemonReady: Promise<void> | null = null;

export function resetCuaDaemonReady(): void {
  daemonReady = null;
}

export class CuaDriver {
  readonly command: string;
  readonly extraArgs: string[];
  readonly source: string;

  constructor(resolved = resolveCuaDriverCommand()) {
    this.command = resolved.command;
    this.extraArgs = resolved.extraArgs;
    this.source = resolved.source;
  }

  private async run(
    argv: string[],
    opts: { timeoutMs?: number; allowNonZero?: boolean; signal?: AbortSignal } = {},
  ): Promise<CuaCliResult> {
    if (isComputerUseDisabled()) {
      throw new CuaDriverError(
        "Computer Use is disabled (COMPUTER_USE_DISABLED=1).",
        "disabled",
        "Unset COMPUTER_USE_DISABLED to enable CUA Driver computer control.",
      );
    }
    const args = [...this.extraArgs, ...argv];
    try {
      const { stdout, stderr } = await execFileAsync(this.command, args, {
        timeout: opts.timeoutMs ?? cuaDriverTimeoutMs(),
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        signal: opts.signal,
      });
      return {
        raw: `${stdout || ""}${stderr || ""}`,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        code: 0,
      };
    } catch (error: unknown) {
      const e = error as {
        code?: string | number;
        message?: string;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        killed?: boolean;
        signal?: string;
      };
      const stdout = String(e?.stdout ?? "");
      const stderr = String(e?.stderr ?? "");
      const raw = `${stdout}${stderr}`;
      const exitCode = typeof e?.code === "number" ? e.code : 1;

      if (e?.code === "ENOENT" || /not recognized as an internal|command not found/i.test(e?.message || "")) {
        throw new CuaDriverError(CUA_DRIVER_INSTALL_HINT, "not_installed", CUA_DRIVER_INSTALL_HINT);
      }

      if (opts.allowNonZero) {
        return { raw, stdout, stderr, code: exitCode };
      }

      const toolError = parseToolError(
        argv[0] === "call" ? argv[1] || "cua" : "cua",
        stdout || raw,
      );
      if (toolError) throw toolError;

      if (looksLikeDaemonDown(raw)) {
        throw new CuaDriverError(
          "The CUA Driver daemon is not running.",
          "daemon_unavailable",
          "Qube starts the daemon automatically; if this persists run `cua-driver serve` and retry.",
        );
      }

      if (e?.killed || e?.signal === "SIGTERM" || /timed? ?out|timeout/i.test(e?.message || "")) {
        throw new CuaDriverError(
          `CUA Driver timed out after ${opts.timeoutMs ?? cuaDriverTimeoutMs()}ms.`,
          "timeout",
          "Re-run computer_get_app_state for a fresh state, then retry once with a simpler action.",
        );
      }

      const parsed = parseCuaOutput(stdout || raw);
      if (parsed.isError) throw new CuaToolError("cua", parsed);
      const info = translateCuaFailure(
        errorMessageFrom(parsed.data, raw || e?.message || String(error)),
        parsed.data,
      );
      throw new CuaDriverError(info.message, info.code, info.hint, { stdout, stderr });
    }
  }

  async status(): Promise<{ running: boolean; raw: string }> {
    const out = await this.run(["status"], { timeoutMs: 6000, allowNonZero: true });
    return { running: /daemon is running|is running on/i.test(out.raw), raw: out.raw };
  }

  async ensureDaemon(): Promise<void> {
    if (daemonReady) return daemonReady;
    daemonReady = (async () => {
      const current = await this.status();
      if (current.running) return;
      if (!cuaDriverAutoStart()) {
        throw new CuaDriverError(
          "The CUA Driver daemon is not running.",
          "daemon_unavailable",
          "Start it with `cua-driver serve`, then retry.",
        );
      }
      await this.startDaemon();
      const timeoutAt = Date.now() + cuaDriverStartTimeoutMs();
      while (Date.now() < timeoutAt) {
        try {
          const next = await this.status();
          if (next.running) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new CuaDriverError(
        "CUA Driver did not become ready in time.",
        "daemon_unavailable",
        "Run `cua-driver serve` in a terminal and retry. On macOS, also run `cua-driver doctor` to grant permissions.",
      );
    })().catch((error) => {
      daemonReady = null;
      throw error;
    });
    return daemonReady;
  }

  private async startDaemon(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.command, [...this.extraArgs, "serve"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: process.env,
        });
      } catch (error) {
        reject(
          new CuaDriverError(
            `Could not start CUA Driver: ${(error as Error)?.message || String(error)}`,
            "daemon_unavailable",
            CUA_DRIVER_INSTALL_HINT,
          ),
        );
        return;
      }
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.once("error", (error) => {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          settle(() =>
            reject(new CuaDriverError(CUA_DRIVER_INSTALL_HINT, "not_installed", CUA_DRIVER_INSTALL_HINT)),
          );
        } else {
          settle(() =>
            reject(
              new CuaDriverError(
                `Could not start CUA Driver: ${(error as Error)?.message || String(error)}`,
                "daemon_unavailable",
                CUA_DRIVER_INSTALL_HINT,
              ),
            ),
          );
        }
      });
      // Give spawn a tick to report ENOENT, then detach so the daemon
      // outlives the request that woke it.
      setTimeout(() => {
        try {
          child.unref();
        } catch {}
        settle(resolve);
      }, 350);
    });
  }

  async call(
    tool: string,
    args: Record<string, unknown> = {},
    opts: CuaCallOptions = {},
  ): Promise<ParsedCuaOutput> {
    await this.ensureDaemon();
    const argv = ["call", tool, JSON.stringify(args ?? {})];
    if (opts.screenshotOutFile) {
      argv.push("--screenshot-out-file", opts.screenshotOutFile);
    }
    let result: CuaCliResult;
    try {
      result = await this.run(argv, { timeoutMs: opts.timeoutMs, signal: opts.signal });
    } catch (error) {
      // A daemon can die between status and call. The call never executed, so
      // one fresh ensure + retry is safe and avoids a confusing failure.
      if (error instanceof CuaDriverError && error.code === "daemon_unavailable") {
        resetCuaDaemonReady();
        await this.ensureDaemon();
        result = await this.run(argv, { timeoutMs: opts.timeoutMs, signal: opts.signal });
      } else {
        throw error;
      }
    }

    const parsed = parseCuaOutput(result.stdout || result.raw);
    if (parsed.isError) throw new CuaToolError(tool, parsed);
    if (!parsed.data && !parsed.text) {
      return { data: { ok: true, empty: true }, text: "", raw: result.raw, isError: false };
    }
    return parsed;
  }

  /** Run a non-`call` CLI command (doctor/list-tools/status). */
  async cli(argv: string[], opts: { timeoutMs?: number; allowNonZero?: boolean } = {}): Promise<CuaCliResult> {
    return this.run(argv, {
      timeoutMs: opts.timeoutMs,
      allowNonZero: opts.allowNonZero ?? false,
    });
  }

  async doctor(): Promise<{ raw: string; data: Record<string, unknown> | null }> {
    const out = await this.cli(["doctor", "--json"], { timeoutMs: 45000, allowNonZero: true });
    try {
      const parsed = JSON.parse(out.stdout || "{}");
      return { raw: out.raw, data: asRecord(parsed) };
    } catch {
      return { raw: out.raw, data: null };
    }
  }

  async listToolDescriptions(): Promise<Array<{ name: string; description: string }>> {
    const out = await this.cli(["list-tools"], { timeoutMs: 15000, allowNonZero: true });
    return String(out.stdout || out.raw)
      .split(/\r?\n/)
      .map((line) => /^([a-z0-9_]+):\s*(.*)$/i.exec(line.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1], description: m[2] }));
  }
}

export function cuaErrorMessage(error: unknown): string {
  if (error instanceof CuaDriverError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function cuaErrorCode(error: unknown): string {
  if (error instanceof CuaDriverError) return error.code;
  return "cua_error";
}

export function cuaErrorHint(error: unknown): string | undefined {
  return error instanceof CuaDriverError ? error.hint : undefined;
}

export function cuaErrorPayload(tool: string, error: unknown): string {
  if (error instanceof CuaDriverError) {
    return JSON.stringify({
      error: true,
      tool,
      code: error.code,
      message: error.message.slice(0, 2000),
      hint: error.hint,
      ...(error instanceof CuaToolError ? { details: error.parsed.data } : {}),
    });
  }
  return JSON.stringify({
    error: true,
    tool,
    message: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    hint: "Run computer_get_app_state to inspect the app, then retry once with a different method.",
  });
}

export { missingBinaryError };

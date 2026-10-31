/**
 * Computer Use tools — OS-level control via open-codex-computer-use (`ocu`).
 *
 * Qube-facing names are prefixed (`computer_list_apps`, `computer_click`, …)
 * so they never collide with the managed-browser tools (`click`, `type`,
 * `press_key`, `browser_*`, obu session tools).
 *
 * CRITICAL ocu semantics: `element_index` state lives PER-PROCESS. A
 * `get_app_state` in one `ocu call` process cannot be reused by a `click`
 * in another process ("No app state is available …"). The upstream remedy
 * is `ocu call --calls '[{tool,args},…]'`, which runs observe + act in ONE
 * process. That is why `computer_run_sequence` exists and why the system
 * prompt teaches sequence-first: single action tools called piecemeal WILL
 * fail on element actions. Each tool still shells out and returns the
 * MCP-style JSON result as text.
 *
 * Safety:
 * - Read-only tools (list_apps / get_app_state / list_windows / get_window /
 *   get_window_state / doctor / capabilities) run without pausing.
 * - Mutating tools (click / secondary / scroll / drag / type_text /
 *   press_key / set_value / launch_app / activate_window / run_sequence)
 *   go through withPermissionCheck in interactive sessions, so the chat
 *   BLOCKS on the approval card. In background runs (no interactive user)
 *   they refuse with a clear message instead of acting blindly.
 */

import { tool } from "ai";
import { z } from "zod";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  resolveComputerCommand,
  computerUseTimeoutMs,
  isComputerUseDisabled,
  missingBinaryError,
} from "./computer-use-mcp";

const execFileAsync = promisify(execFile);

export type ClipboardCmd = { cmd: string; args: string[]; useStdin: boolean };

/**
 * Native clipboard commands per OS (ocu has no clipboard tool, so Qube
 * drives the platform clipboard directly). Reads run without approval;
 * writes go through the approval gate like all other computer_* mutations.
 * Pure selector — unit-tested without touching a real clipboard.
 */
export function clipboardCommands(platform: string): {
  read: ClipboardCmd[];
  write: ClipboardCmd[];
  installHint: string;
} {
  if (platform === "darwin") {
    return {
      read: [{ cmd: "pbpaste", args: [], useStdin: false }],
      write: [{ cmd: "pbcopy", args: [], useStdin: true }],
      installHint: "pbcopy/pbpaste ship with macOS — no install needed.",
    };
  }
  if (platform === "win32") {
    return {
      read: [{ cmd: "powershell", args: ["-noprofile", "-command", "Get-Clipboard"], useStdin: false }],
      write: [{ cmd: "powershell", args: ["-noprofile", "-command", "$input | Set-Clipboard"], useStdin: true }],
      installHint: "Clipboard cmdlets ship with Windows PowerShell 5.1+.",
    };
  }
  return {
    read: [
      { cmd: "xclip", args: ["-selection", "clipboard", "-o"], useStdin: false },
      { cmd: "xsel", args: ["--clipboard", "--output"], useStdin: false },
    ],
    write: [
      { cmd: "xclip", args: ["-selection", "clipboard", "-i"], useStdin: true },
      { cmd: "xsel", args: ["--clipboard", "--input"], useStdin: true },
    ],
    installHint: "Install a clipboard helper: `sudo apt install xclip` (or xsel). Headless servers without X/Wayland have no clipboard.",
  };
}

function runWithStdin(cmd: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      const err = new Error("clipboard write timed out") as Error & { code?: string };
      reject(err);
    }, timeoutMs);
    try { child.stderr?.on("data", (d) => { stderr += String(d); }); } catch {}
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve("");
      else {
        const err = new Error(stderr.trim() || `clipboard writer exited ${code}`) as Error & { code?: string };
        if (/not recognized|not found|ENOENT/i.test(stderr)) (err as { code?: string }).code = "ENOENT";
        reject(err);
      }
    });
    try {
      if (!child.stdin) throw new Error("no stdin on clipboard writer");
      child.stdin.on("error", () => {});
      child.stdin.write(input);
      child.stdin.end();
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

async function tryCandidates(cands: ClipboardCmd[], input?: string): Promise<{ cmd: string; out: string }> {
  let lastErr = "";
  for (const c of cands) {
    try {
      if (c.useStdin) {
        await runWithStdin(c.cmd, c.args, input ?? "", 10000);
        return { cmd: c.cmd, out: "" };
      }
      const { stdout } = await execFileAsync(c.cmd, c.args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      return { cmd: c.cmd, out: (stdout || "").toString() };
    } catch (e: unknown) {
      const err = e as { code?: unknown; message?: string };
      lastErr = (typeof err?.message === "string" ? err.message : String(e)).slice(0, 300);
      void lastErr;
    }
  }
  throw new Error("unavailable");
}

export async function runClipboardRead(): Promise<string> {
  const { read, installHint } = clipboardCommands(process.platform);
  try {
    const { out } = await tryCandidates(read);
    const text = out.replace(/\r\n/g, "\n");
    return JSON.stringify({
      tool: "computer_clipboard_read",
      chars: text.length,
      truncated: text.length > 4000,
      text: text.slice(0, 4000),
    });
  } catch {
    return JSON.stringify({ error: true, tool: "computer_clipboard_read", message: `Clipboard read unavailable on this machine. ${installHint}` });
  }
}

export async function runClipboardWrite(text: string): Promise<string> {
  const t = String(text ?? "");
  if (!t) return JSON.stringify({ error: true, tool: "computer_clipboard_write", message: "text is required." });
  if (t.length > 100000) return JSON.stringify({ error: true, tool: "computer_clipboard_write", message: "Clipboard text capped at 100k chars." });
  const { write, installHint } = clipboardCommands(process.platform);
  try {
    await tryCandidates(write, t);
    return JSON.stringify({ tool: "computer_clipboard_write", status: "ok", chars: t.length });
  } catch {
    return JSON.stringify({ error: true, tool: "computer_clipboard_write", message: `Clipboard write unavailable on this machine. ${installHint}` });
  }
}

export type ComputerToolsOptions = {
  /** Foreground chat passes true (default); subagents/scheduler pass false. */
  includeAskUser?: boolean;
};

const labelField = z
  .string()
  .optional()
  .describe("Short playful label for the activity card (e.g. 'Opening Notes')");

/** ocu tool names accepted inside a --calls sequence (9 core + window tools). */
const SEQUENCE_TOOL_NAMES = [
  "list_apps",
  "get_app_state",
  "click",
  "perform_secondary_action",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "set_value",
  "list_windows",
  "get_window",
  "get_window_state",
  "launch_app",
  "activate_window",
] as const;

/**
 * Translate cryptic ocu failures into actionable guidance. ocu reports
 * tool errors as exit-0 JSON with isError:true, so the raw text (e.g.
 * `unsupportedTool("launch_app")`) would otherwise reach the model raw.
 * Returns the enriched JSON string, or null when no translation applies.
 */
export function translateOcuError(out: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(out);
  } catch {
    return null;
  }
  const text: string = (() => {
    try {
      const parts = parsed?.content;
      if (Array.isArray(parts)) return parts.map((p: any) => p?.text || "").join("\n");
      if (typeof parsed?.text === "string") return parsed.text;
    } catch {}
    return "";
  })();
  const isError = parsed?.isError === true;
  if (!isError || !text) return null;
  // Window-level tools exist only on Windows upstream (macOS/Linux in progress).
  const unsupported = /unsupportedTool\("([^"]+)"\)/.exec(text);
  if (unsupported) {
    const name = unsupported[1];
    return JSON.stringify({
      error: true,
      tool: name,
      message: `The "${name}" window tool is not supported by the ocu runtime on this OS (window tools are Windows-only upstream; macOS/Linux support is in progress).`,
      hint: "Do NOT retry the same call. To open an app, use run_command instead (e.g. `nohup <app> >/dev/null 2>&1 &` or `xdg-open <file-or-url>` on Linux, `open -a <App>` on macOS). To foreground a window, click it via computer_run_sequence after computer_list_apps/computer_get_app_state.",
    });
  }
  // Per-process element state: action tools called outside a sequence.
  if (/No app state is available for/i.test(text)) {
    return JSON.stringify({
      error: true,
      message: text.slice(0, 500),
      hint: "ocu keeps element_index state PER PROCESS: a get_app_state from an earlier tool call cannot be reused. Do NOT retry the single action tool. Instead, run observe + act TOGETHER in one computer_run_sequence call (--calls runs them in a single ocu process, e.g. [{tool:'get_app_state',args:{app}},{tool:'click',args:{app,element_index}}]).",
    });
  }
  // ocu matches app names strictly: fuzzy names fail even when the app runs.
  const notFound = /appNotFound\("([^"]+)"\)/.exec(text);
  if (notFound) {
    return JSON.stringify({
      error: true,
      message: text.slice(0, 300),
      hint: `ocu needs the EXACT running-app name from computer_list_apps (e.g. "gnome-text-editor", not "${notFound[1]}"). Copy it verbatim — do not shorten or reshape bundle ids by hand. Re-run computer_list_apps if unsure, then retry the sequence with the exact name.`,
    });
  }
  // Screen-state verification failures: the click missed or nothing changed.
  if (/element not (visible|found)|not clickable|click (missed|failed)|no change|same state/i.test(text)) {
    return JSON.stringify({
      error: true,
      message: text.slice(0, 500),
      hint: "Screen-state verification failed: the target moved or the click missed. Re-run computer_get_app_state for a FRESH tree + screenshot, re-ground the element's coordinates from the new screenshot (do not reuse old coordinates), then retry once via computer_run_sequence. If it fails again, switch methods (element_index ↔ coordinates ↔ keyboard shortcut).",
    });
  }
  return null;
}

function enrichOcuOutput(ocuTool: string, out: string): string {
  try {
    const translated = translateOcuError(out);
    if (translated) return translated;
  } catch {}
  return out;
}

/** Best-effort JSON parse for embedding ocu output in wrapper results. */
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return String(s).slice(0, 2000); }
}

/** Cheap screen-change check: tree/window text drift between two states. */
function stateChanged(before: string, after: string): boolean {
  try {
    const norm = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
    const a = norm(before);
    const b = norm(after);
    if (!a || !b) return true; // unparseable — don't claim "unchanged"
    if (a === b) return false;
    // Hash windows: identical length + tiny diff = likely unchanged.
    let diff = 0;
    const n = Math.min(a.length, b.length, 20000);
    for (let i = 0; i < n; i += 7) if (a[i] !== b[i]) diff++;
    if (Math.abs(a.length - b.length) < 50 && diff < 3) return false;
    return true;
  } catch { return true; }
}

async function runOcuCall(ocuTool: string, args: Record<string, unknown>): Promise<string> {
  if (isComputerUseDisabled()) {
    return JSON.stringify({
      error: true,
      tool: ocuTool,
      message: "Computer Use is disabled (COMPUTER_USE_DISABLED=1).",
    });
  }
  const { command, extraArgs } = resolveComputerCommand();
  // Strip Qube-only fields before forwarding to ocu.
  const { label: _label, ...forward } = args || {};
  void _label;
  const argsJson = JSON.stringify(forward);
  const argv = [...extraArgs, "call", ocuTool, "--args", argsJson];
  const timeout = computerUseTimeoutMs();
  try {
    const { stdout, stderr } = await execFileAsync(command, argv, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    const out = (stdout || "").trim();
    if (out) return enrichOcuOutput(ocuTool, out.slice(0, 60000));
    const err = (stderr || "").trim();
    if (err) return JSON.stringify({ tool: ocuTool, warning: err.slice(0, 2000) });
    return JSON.stringify({ tool: ocuTool, status: "ok", empty: true });
  } catch (e: any) {
    const code = e?.code;
    if (code === "ENOENT") return missingBinaryError();
    const stdout = e?.stdout?.toString?.() || "";
    const stderr = e?.stderr?.toString?.() || "";
    const msg = e?.message || String(e);
    if (/not recognized|not found|command not found/i.test(msg) && !stdout) {
      return missingBinaryError();
    }
    const timedOut = e?.killed && (e?.signal === "SIGTERM" || /timed out/i.test(msg));
    return JSON.stringify({
      error: true,
      tool: ocuTool,
      message: msg.slice(0, 1000),
      stdout: stdout.slice(0, 4000) || undefined,
      stderr: stderr.slice(0, 4000) || undefined,
      timedOut: timedOut || undefined,
      hint: timedOut
        ? "The app took too long. Re-run get_app_state first, then retry once with a simpler action."
        : "Re-run get_app_state for fresh element indexes, then retry once. Never replay uncertain actions blindly.",
    });
  }
}

async function runOcuRaw(argv: string[]): Promise<string> {
  if (isComputerUseDisabled()) {
    return JSON.stringify({ error: true, message: "Computer Use is disabled (COMPUTER_USE_DISABLED=1)." });
  }
  const { command, extraArgs } = resolveComputerCommand();
  const timeout = computerUseTimeoutMs();
  try {
    const { stdout } = await execFileAsync(command, [...extraArgs, ...argv], {
      timeout,
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true,
    });
    return ((stdout || "").trim() || "{}").slice(0, 20000);
  } catch (e: any) {
    if (e?.code === "ENOENT") return missingBinaryError();
    return JSON.stringify({ error: true, message: (e?.message || String(e)).slice(0, 1000) });
  }
}

/**
 * Run an observe → act sequence in ONE ocu process (`ocu call --calls`).
 * This is the ONLY reliable way to use element_index: ocu keeps element
 * state per process, so get_app_state + click/type/key MUST share a
 * process. Steps run in order with a short sleep between successful
 * operations (default 1s upstream).
 */export async function runOcuSequence(
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
  sleepSecs?: number,
): Promise<string> {
  if (isComputerUseDisabled()) {
    return JSON.stringify({ error: true, message: "Computer Use is disabled (COMPUTER_USE_DISABLED=1)." });
  }
  const known = new Set<string>(SEQUENCE_TOOL_NAMES);
  for (const [i, c] of calls.entries()) {
    if (!c || typeof c.tool !== "string" || !known.has(c.tool)) {
      return JSON.stringify({
        error: true,
        message: `Sequence step ${i} has unknown tool "${(c as any)?.tool}". Valid: ${SEQUENCE_TOOL_NAMES.join(", ")}.`,
      });
    }
    if (!c.args || typeof c.args !== "object") {
      return JSON.stringify({ error: true, message: `Sequence step ${i} (${c.tool}) needs an args object.` });
    }
  }
  const { command, extraArgs } = resolveComputerCommand();
  const argv = [...extraArgs, "call", "--calls", JSON.stringify(calls)];
  if (typeof sleepSecs === "number" && Number.isFinite(sleepSecs)) {
    argv.push("--sleep", String(Math.min(Math.max(sleepSecs, 0), 10)));
  }
  // Sequences carry full trees per step: allow a longer timeout.
  const timeout = Math.max(computerUseTimeoutMs(), 120000);
  try {
    const { stdout, stderr } = await execFileAsync(command, argv, {
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    const out = (stdout || "").trim();
    if (out) return enrichOcuOutput("sequence", out.slice(0, 60000));
    const err = (stderr || "").trim();
    if (err) return JSON.stringify({ warning: err.slice(0, 2000) });
    return JSON.stringify({ status: "ok", empty: true });
  } catch (e: any) {
    if (e?.code === "ENOENT") return missingBinaryError();
    const stdout = e?.stdout?.toString?.() || "";
    // ocu may exit non-zero after completing some steps: surface what ran.
    if (stdout.trim()) return enrichOcuOutput("sequence", stdout.trim().slice(0, 60000));
    const msg = e?.message || String(e);
    if (/not recognized|not found|command not found/i.test(msg)) return missingBinaryError();
    return JSON.stringify({ error: true, message: msg.slice(0, 1000) });
  }
}

/**
 * Normalize an app token for matching against `list_apps` output
 * ("org.gnome.TextEditor" / "TextEditor.desktop" / "Text Editor" all match
 * a "gnome-text-editor" listing).
 */
export function matchesAppName(listOutput: string, app: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\.desktop$/i, "").replace(/[^a-z0-9]+/g, "");
  const want = norm(app);
  if (!want) return false;
  // Tokenize the listing the same way and accept substring matches either way
  // (handles "Text Editor" vs "texteditor" and "ptyxis" vs "ptyxis-agent").
  const hay = norm(listOutput);
  if (hay.includes(want)) return true;
  // Else fall back to the single most distinctive dot-segment
  // (org.gnome.TextEditor -> texteditor). Any-segment matching is deliberately
  // avoided: generic segments like "gnome" would match unrelated apps
  // ("gnome-calculator" must NOT match a "gnome-shell" listing).
  const longest = app
    .toLowerCase()
    .split(/[.\s_-]+/)
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length)[0];
  return !!longest && hay.includes(norm(longest));
}

function spawnDetached(cmd: string, args: string[]): Promise<{ pid?: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", (e) => resolve({ error: (e as Error)?.message || String(e) }));
      // Give spawn a tick to report ENOENT etc, then detach.
      setTimeout(() => {
        try {
          child.unref();
        } catch {}
        resolve({ pid: child.pid });
      }, 300);
    } catch (e: any) {
      resolve({ error: e?.message || String(e) });
    }
  });
}

async function resolveBinary(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${JSON.stringify(name)}`], {
      timeout: 5000,
      windowsHide: true,
    });
    const p = (stdout || "").trim().split("\n")[0]?.trim();
    return p || null;
  } catch {
    return null;
  }
}

/**
 * Launch fallback for OSes where ocu has no native window tools (macOS /
 * Linux upstream: launch_app/activate_window are Windows-only). Spawns the
 * app detached with the server's desktop-session environment (the Qube
 * server runs inside the user's graphical session, so DISPLAY/Wayland and
 * the session bus are already present) and then VERIFIES via list_apps —
 * a bare spawn is not proof, since GApplication-style apps daemonize and
 * naive "is it running" checks mislead (this exact misdiagnosis stalled an
 * earlier session: the app had launched fine while the agent reported it
 * dead). Returns evidence either way.
 */
export async function runLaunchAppFallback(app: string): Promise<string> {
  const token = (app || "").trim();
  if (!token) return JSON.stringify({ error: true, message: "app name is required." });
  const platform = process.platform;
  const attempts: string[] = [];
  let spawnResult: { pid?: number; error?: string } | null = null;

  if (platform === "darwin") {
    attempts.push(`open -a ${token}`);
    spawnResult = await new Promise((resolve) => {
      try {
        const child = spawn("open", ["-a", token], { detached: true, stdio: "ignore" });
        child.on("error", (e) => resolve({ error: (e as Error)?.message || String(e) }));
        setTimeout(() => {
          try { child.unref(); } catch {}
          resolve({ pid: child.pid });
        }, 300);
      } catch (e: any) {
        resolve({ error: e?.message || String(e) });
      }
    });
  } else {
    // Linux and others: prefer the literal binary, then desktop-id launchers.
    const first = token.split(/\s+/)[0];
    const rest = token.split(/\s+/).slice(1);
    const bin = await resolveBinary(first);
    if (bin) {
      attempts.push(bin + (rest.length ? ` ${rest.join(" ")}` : ""));
      spawnResult = await spawnDetached(bin, rest);
    } else {
      for (const launcher of [
        { cmd: "gtk-launch", args: [token] },
        { cmd: "gtk-launch", args: [`${token}.desktop`] },
        { cmd: "gio", args: ["launch", token] },
        { cmd: "xdg-open", args: [token] },
      ]) {
        const resolved = await resolveBinary(launcher.cmd);
        if (!resolved) continue;
        attempts.push(`${launcher.cmd} ${launcher.args.join(" ")}`);
        spawnResult = await spawnDetached(resolved, launcher.args);
        if (!spawnResult.error) break;
      }
    }
  }

  if (!spawnResult) {
    return JSON.stringify({
      error: true,
      tool: "computer_launch_app",
      message: `Could not launch "${token}" — no launcher found (tried: ${attempts.join("; ") || "none"}).`,
      hint: "Run computer_list_apps for exact running-app names, or install the app / pass its binary name or .desktop id.",
    });
  }
  if (spawnResult.error && spawnResult.pid === undefined) {
    return JSON.stringify({
      error: true,
      tool: "computer_launch_app",
      message: `Launch spawn failed for "${token}": ${spawnResult.error}`,
      attempts,
    });
  }

  // Verify: poll list_apps until the app is visible to the accessibility layer.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const listing = await runOcuCall("list_apps", {});
      if (matchesAppName(listing, token)) {
        return JSON.stringify({
          status: "launched",
          app: token,
          pid: spawnResult.pid,
          attempts,
          verified: true,
          hint: "App is visible to the accessibility layer. Call computer_get_app_state (or a computer_run_sequence starting with it) to see its window before acting.",
        });
      }
    } catch {}
  }
  return JSON.stringify({
    error: true,
    tool: "computer_launch_app",
    message: `Spawned "${token}" (pid ${spawnResult.pid ?? "?"}) but it never appeared in list_apps after ~12s. It may have failed to open a window or uses a different app id.`,
    attempts,
    hint: "Run computer_list_apps to see what actually appeared, then use that exact name. GApplication-style apps sometimes need a file/URI argument to open a window.",
  });
}

/**
 * Foreground fallback for OSes where ocu has no native window tools.
 * GNOME Shell's FocusApp D-Bus method is AccessDenied to third parties and
 * no X11 focus tools exist on Wayland, so the supported mechanism is
 * relaunch-to-focus: single-instance (GApplication) apps present their
 * existing window on a fresh launch instead of opening a duplicate. Verifies
 * the app is visible afterwards; frontmost order itself can only be
 * confirmed visually (screenshot / get_app_state), so the result says so.
 */
export async function runActivateWindowFallback(app: string): Promise<string> {
  const token = (app || "").trim();
  if (!token) return JSON.stringify({ error: true, message: "app name is required." });
  let listing = "";
  try {
    listing = await runOcuCall("list_apps", {});
  } catch {
    listing = "";
  }
  if (!matchesAppName(listing, token)) {
    return JSON.stringify({
      error: true,
      tool: "computer_activate_window",
      message: `"${token}" is not running (no match in list_apps). Activate brings an existing window forward — it cannot start an app.`,
      hint: "Use computer_launch_app to start it, or computer_list_apps for the exact running-app name.",
    });
  }
  const launched = await runLaunchAppFallback(token);
  let ok = false;
  try {
    ok = JSON.parse(launched)?.status === "launched";
  } catch {}
  if (!ok) return launched;
  return JSON.stringify({
    status: "activated",
    app: token,
    verified: true,
    hint: "The app was relaunched to present its window (single-instance focus) and is visible to the accessibility layer. Confirm it is frontmost with computer_get_app_state or a screenshot in the same turn — global focus order is only observable visually.",
  });
}

export function createComputerTools(threadId: string, opts?: ComputerToolsOptions) {  const interactive = opts?.includeAskUser !== false;

  const gate = async (
    qubeTool: string,
    args: Record<string, unknown>,
    run: () => Promise<string>,
  ): Promise<string> => {
    if (!interactive) {
      return JSON.stringify({
        error: true,
        tool: qubeTool,
        available: false,
        message:
          "Computer control needs an interactive user to approve it. Background runs cannot click/type/press keys. Return read-only findings (list_apps/get_app_state) and leave actions for the foreground chat.",
      });
    }
    try {
      const { withPermissionCheck } = await import("@/lib/middleware/permission-middleware");
      return await withPermissionCheck(qubeTool, args, threadId, run);
    } catch {
      return await run();
    }
  };

  return {
    computer_list_apps: tool({
      description:
        "List running and recently used OS apps (open-codex-computer-use list_apps). Call BEFORE any computer action to get valid app names/bundle ids. Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async (args: any) => runOcuCall("list_apps", args ?? {}),
    }),

    computer_get_app_state: tool({
      description:
        "Read an OS app's accessibility tree + screenshot (open-codex-computer-use get_app_state). Call immediately before element actions and re-run after navigation, modals, or failures — element_index values go stale fast. Read-only, no approval needed.",
      inputSchema: z
        .object({
          app: z.string().describe("App name or bundle id from computer_list_apps"),
          text_limit: z.union([z.number(), z.string()]).optional(),
          max_tree_nodes: z.number().optional(),
          max_tree_depth: z.number().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) => runOcuCall("get_app_state", args ?? {}),
    }),

    computer_click: tool({
      description:
        "Click an OS app element by element_index from computer_get_app_state, or by screenshot coordinates when the tree has no target. Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat. When clicking by coordinates, pass verify:true to re-read app state after the click and confirm the expected window/element changed; on mismatch the result carries a retry hint with fresh grounding instructions.",
      inputSchema: z
        .object({
          app: z.string().describe("App name or bundle id"),
          element_index: z.string().optional().describe("Element index from get_app_state"),
          verify: z.boolean().optional().describe("Re-read app state after clicking and verify a UI change (default false)"),
          x: z.number().optional(),
          y: z.number().optional(),
          button: z.string().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_click", args ?? {}, async () => {
          const { verify: _verify, ...forward } = args ?? {};
          void _verify;
          const res = await runOcuCall("click", forward);
          // Screen-state verification: re-read app state and confirm the UI
          // changed (window title / tree hash drift). Coordinate clicks that
          // silently miss are the #1 desktop failure mode — verify catches it
          // in the same turn instead of costing a model round-trip.
          if ((args as any)?.verify === true && typeof forward?.app === "string" && forward.app) {
            try {
              const after = await runOcuCall("get_app_state", { app: forward.app });
              const changed = stateChanged(res, after);
              if (!changed) {
                return JSON.stringify({
                  warning: "click sent but screen state looks unchanged",
                  click: safeParse(res),
                  hint: "Re-ground from a FRESH computer_get_app_state screenshot (do not reuse old coordinates), then retry once via computer_run_sequence. If it fails again, switch methods (element_index ↔ coordinates ↔ keyboard).",
                }).slice(0, 8000);
              }
              return JSON.stringify({ ok: true, verified: "screen-changed", click: safeParse(res) }).slice(0, 8000);
            } catch {}
          }
          return res;
        }),
    }),

    computer_secondary_action: tool({
      description:
        "Invoke an OS app element's own secondary action (right-click / alternate action) via perform_secondary_action. Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string(),
          element_index: z.string().describe("Element index from get_app_state"),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_secondary_action", args ?? {}, () =>
          runOcuCall("perform_secondary_action", args ?? {}),
        ),
    }),

    computer_scroll: tool({
      description:
        "Scroll an OS app element (by pages) or window (by pixel deltas). Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string(),
          element_index: z.string().optional(),
          direction: z.string().optional(),
          pages: z.number().optional(),
          delta_x: z.number().optional(),
          delta_y: z.number().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_scroll", args ?? {}, () => runOcuCall("scroll", args ?? {})),
    }),

    computer_drag: tool({
      description: "Drag between two coordinates in an OS app. Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_drag", args ?? {}, () => runOcuCall("drag", args ?? {})),
    }),

    computer_type_text: tool({
      description:
        "Type text into an OS app (Unicode-safe, background-first). Prefer set_value for settable controls. Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string(),
          text: z.string().describe("Text to type"),
          element_index: z.string().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_type_text", args ?? {}, () => runOcuCall("type_text", args ?? {})),
    }),

    computer_press_key: tool({
      description:
        "Press a key or chord in an OS app (e.g. return, escape, ctrl+s, page_up). Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string(),
          key: z.string().describe("Key or chord, e.g. 'return', 'ctrl+s'"),
          element_index: z.string().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_press_key", args ?? {}, () => runOcuCall("press_key", args ?? {})),
    }),

    computer_set_value: tool({
      description:
        "Set an OS app control's value directly (text fields, sliders). Prefer over typing when available. Prefer computer_run_sequence for element actions (single calls cannot reuse another call's element_index state). Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string(),
          element_index: z.string().describe("Element index from get_app_state"),
          value: z.string(),
          label: labelField,
        })
        .passthrough(),
      execute: async (args: any) =>
        gate("computer_set_value", args ?? {}, () => runOcuCall("set_value", args ?? {})),
    }),

    computer_launch_app: tool({
      description:
        "Launch an OS app by name and VERIFY it appeared (polls list_apps). On Windows uses the native ocu window tool; on macOS/Linux spawns via the desktop session (open -a / binary / gtk-launch) since ocu window tools are Windows-only upstream. Needs user approval in chat.",
      inputSchema: z.object({ app: z.string(), label: labelField }).passthrough(),
      execute: async (args: any) => {
        const app = String((args as any)?.app || "");
        if (process.platform === "win32") {
          return gate("computer_launch_app", args ?? {}, () => runOcuCall("launch_app", args ?? {}));
        }
        return gate("computer_launch_app", args ?? {}, () => runLaunchAppFallback(app));
      },
    }),

    computer_activate_window: tool({
      description:
        "Bring an OS app window to the front and VERIFY it is visible. On Windows uses the native ocu window tool; on macOS/Linux relaunches the running app to present its window (single-instance focus) since Shell focus APIs deny third parties. Confirm frontmost visually afterwards. Needs user approval in chat.",
      inputSchema: z.object({ app: z.string(), label: labelField }).passthrough(),
      execute: async (args: any) => {
        const app = String((args as any)?.app || "");
        if (process.platform === "win32") {
          return gate("computer_activate_window", args ?? {}, () =>
            runOcuCall("activate_window", args ?? {}),
          );
        }
        return gate("computer_activate_window", args ?? {}, () => runActivateWindowFallback(app));
      },
    }),

    computer_doctor: tool({
      description:
        "Check Computer Use permissions/install (ocu doctor). On macOS reports Accessibility + Screen Recording. Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () => runOcuRaw(["doctor", "--json"]),
    }),

    computer_clipboard_read: tool({
      description:
        "Read the OS clipboard text (up to 4000 chars). Use to grab copied links, codes, or text the user copied for you. Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () => runClipboardRead(),
    }),

    computer_clipboard_write: tool({
      description:
        "Write text to the OS clipboard (up to 100k chars). Use to hand links, code, or results to the user for pasting elsewhere. Needs user approval in chat.",
      inputSchema: z.object({ text: z.string().describe("Text to put on the clipboard"), label: labelField }).passthrough(),
      execute: async (args: any) =>
        gate("computer_clipboard_write", args ?? {}, () => runClipboardWrite(String((args as any)?.text ?? ""))),
    }),

    computer_capabilities: tool({
      description:
        "Inspect the local computer-use runtime availability (ocu capabilities). Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () => runOcuRaw(["capabilities", "--json"]),
    }),

    computer_run_sequence: tool({
      description:
        "PREFERRED way to act on OS apps: run observe + act steps TOGETHER in one ocu process (ocu keeps element_index state per process, so a get_app_state from any other call CANNOT be reused — piecemeal click/type/press_key calls WILL fail with 'No app state is available'). ALWAYS start the sequence with get_app_state for the target app, then the element actions using that same call's indexes (e.g. [{tool:'get_app_state',args:{app:'TextEdit'}},{tool:'click',args:{app:'TextEdit',element_index:'0'}}]). Steps run in order with a short sleep between successes. Needs user approval in chat.",
      inputSchema: z.object({
        calls: z
          .array(
            z.object({
              tool: z.enum(SEQUENCE_TOOL_NAMES as unknown as [string, ...string[]]),
              args: z.record(z.string(), z.any()),
            }),
          )
          .min(1)
          .max(12)
          .describe("Ordered steps: get_app_state first, then element actions"),
        sleep: z.number().optional().describe("Seconds between successful steps (default 1, max 10)"),
        label: labelField,
      }),
      execute: async (args: any) => {
        const calls = (args?.calls ?? []) as Array<{ tool: string; args: Record<string, unknown> }>;
        // Observation-only sequences (list/get/doctor-style steps) never
        // pause — consistent with the read-only single tools. Anything that
        // can click/type/change goes through the approval gate.
        const readOnly = new Set([
          "list_apps",
          "get_app_state",
          "list_windows",
          "get_window",
          "get_window_state",
        ]);
        const allReadOnly = calls.length > 0 && calls.every((c) => readOnly.has(c?.tool));
        if (allReadOnly && interactive) {
          return runOcuSequence(calls, args?.sleep);
        }
        return gate("computer_run_sequence", args ?? {}, () =>
          runOcuSequence(calls, args?.sleep),
        );
      },
    }),
  };
}

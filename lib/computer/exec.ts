/**
 * Command execution inside the Qube Computer.
 *
 * Commands run with cwd locked to the computer's home directory, HOME /
 * XDG_* / TMPDIR pointed inside the runtime, and credential-looking
 * environment variables stripped, so an agent command cannot read the
 * user's secrets or wander the host filesystem by accident. The process
 * tree is killed on timeout (and the timeout is bounded), output is
 * capped, and every command lands in the activity journal the panel shows.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { appendActivity, ensureComputer } from "./session";
import { resolveRuntimePath } from "./files";
import type { ComputerPaths } from "./paths";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
export const MAX_OUTPUT_BYTES = 256 * 1024;

export type ExecResult = {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

const SECRET_ENV = /(API_KEY|_TOKEN$|^TOKEN$|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|SESSION_KEY)/i;
const DROP_ENV_NAMES = new Set([
  "NODE_OPTIONS",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CLERK_SECRET_KEY",
  "TURSO_AUTH_TOKEN",
]);

/**
 * The environment a computer command sees. Pure for testability.
 */
export function computerEnv(paths: ComputerPaths, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (key.startsWith("QUBE_")) continue; // internal paths/config stay out
    if (DROP_ENV_NAMES.has(key) || SECRET_ENV.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: resolve(paths.home, ".config"),
    XDG_CACHE_HOME: resolve(paths.home, ".cache"),
    XDG_DATA_HOME: resolve(paths.home, ".local/share"),
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,
    PWD: paths.home,
    QUBE_COMPUTER: "1",
    QUBE_COMPUTER_HOME: paths.home,
    QUBE_COMPUTER_ATTACHMENTS: paths.attachments,
    QUBE_COMPUTER_DOWNLOADS: paths.downloads,
  };
}

export function shellCommand(command: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { shell: process.env.SHELL && /(^|\/)(ba|z|k|da)?sh$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/sh", args: ["-c", command] };
}

function clampTimeout(value?: number): number {
  if (!Number.isFinite(value) || !value) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(Math.round(value as number), MAX_TIMEOUT_MS));
}

export async function runInComputer(input: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<ExecResult> {
  const command = (input.command ?? "").trim();
  if (!command) throw new Error("A command is required.");
  const { paths } = ensureComputer();
  const cwd = input.cwd ? await resolveRuntimePath(input.cwd) : paths.home;
  const timeoutMs = clampTimeout(input.timeoutMs);
  const { shell, args } = shellCommand(command);
  const started = Date.now();

  return new Promise<ExecResult>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const capture = (target: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const used = Buffer.byteLength(target === "stdout" ? stdout : stderr, "utf-8");
      if (used >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      const room = MAX_OUTPUT_BYTES - used;
      const slice = Buffer.byteLength(text, "utf-8") > room ? text.slice(0, room) : text;
      if (slice.length < text.length) truncated = true;
      if (target === "stdout") stdout += slice;
      else stderr += slice;
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, args, {
        cwd,
        env: computerEnv(paths) as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolvePromise({
        ok: false,
        command,
        cwd,
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - started,
        stdout: "",
        stderr: (error as Error)?.message || String(error),
        truncated: false,
      });
      return;
    }

    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {}
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 1500).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const result: ExecResult = {
        ok: !timedOut && exitCode === 0,
        command,
        cwd,
        exitCode,
        signal,
        timedOut,
        durationMs,
        stdout,
        stderr,
        truncated,
      };
      appendActivity(
        {
          kind: "exec",
          summary: `${timedOut ? "⏱" : exitCode === 0 ? "✓" : "✗"} ${truncate(command, 160)}`,
          detail: [exitCode !== null ? `exit ${exitCode}` : "", timedOut ? `timed out after ${timeoutMs}ms` : "", `${durationMs}ms`]
            .filter(Boolean)
            .join(" · "),
        },
        paths,
      );
      resolvePromise(result);
    };

    child.on("error", (error) => {
      stderr += `\n${(error as Error)?.message || String(error)}`;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code ?? null, signal ?? null));
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getWorkspacePath } from "@/lib/middleware/workspace";

const execAsync = promisify(exec);

export const runCommandTool = defineTool({
  name: "run_command",
  description:
    "Run a shell command in the workspace (120s default timeout). Use for builds, tests, scripts, and directory inspection. Output truncated to 20k chars per stream. Destructive commands are blocked by the guard hook unless approved. (Never auto-replayed after a crash.)",
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to run" }),
    timeoutMs: Type.Optional(Type.Number({ description: "Timeout in ms, default 120000" })),
  }),
  execute: async (args) => {
    const cwd = getWorkspacePath();
    const timeout = args.timeoutMs ?? 120000;
    const payload = (extra: Record<string, unknown>) => ({
      output: [{ type: "text", text: JSON.stringify({ command: args.command, cwd, ...extra }) }] as Array<{ type: "text"; text: string }>,
    });
    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      return payload({ stdout: stdout.slice(0, 20000), stderr: stderr.slice(0, 20000), exitCode: 0 });
    } catch (e: unknown) {
      const err = e as { stdout?: unknown; stderr?: unknown; message?: string; code?: unknown; killed?: boolean; signal?: string };
      const stdout = String(err.stdout ?? "").slice(0, 20000);
      const stderr = String(err.stderr ?? err.message ?? String(e)).slice(0, 20000);
      const exitCode = typeof err.code === "number" ? err.code : 1;
      const timedOut = err.killed === true && err.signal === "SIGTERM";
      return payload({
        stdout,
        stderr,
        exitCode,
        timedOut,
        ...(timedOut ? { error: `Timeout after ${timeout}ms` } : {}),
      });
    }
  },
});

export function buildShellExtension() {
  return defineExtension({ name: "shell", tools: [runCommandTool] });
}

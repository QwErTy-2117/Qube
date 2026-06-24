"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { TerminalIcon } from "lucide-react";

export const RunCommandToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const command = (args as any)?.command || "";
  const cwd = (args as any)?.cwd || "";
  let data: {
    command?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const cmd = data.command || command;
  const exitCode = data.exitCode ?? 0;
  const stdout = data.stdout || "";
  const stderr = data.stderr || "";
  const hasOutput = stdout || stderr;

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <TerminalIcon className="size-4" />
        <span>Run Command</span>
      </div>
      <div className="mb-2 overflow-auto rounded-md bg-gray-950 p-3 dark:bg-black">
        <pre className="font-mono text-xs text-green-400">$ {cmd}</pre>
        {cwd && (
          <pre className="mt-1 font-mono text-xs text-muted-foreground/60">
            cwd: {cwd}
          </pre>
        )}
      </div>
      {hasOutput && (
        <div className="overflow-auto rounded-md border border-border bg-background p-2">
          {stdout && (
            <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
              {stdout}
            </pre>
          )}
          {stderr && (
            <pre className="whitespace-pre-wrap font-mono text-xs text-red-500">
              {stderr}
            </pre>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Exit code:</span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            exitCode === 0
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {exitCode}
        </span>
      </div>
    </div>
  );
};

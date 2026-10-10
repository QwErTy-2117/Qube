"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileCard } from "./file-card";
import { ToolRow, ToolShellContent } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const RunCommandToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  let data: { command?: string; exitCode?: number; stdout?: string; stderr?: string; generatedFiles?: Array<{ name: string; relativePath: string; size: number }> } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const fullCommand =
    typeof (args as any)?.command === "string" ? (args as any).command : "";
  const running = (status as { type?: string })?.type === "running";
  const verb = friendlyToolLabel("run_command", args);
  const summary = fullCommand || (running ? "…" : "");

  const stdout = (data.stdout || "").slice(0, 4000);
  const stderr = (data.stderr || "").slice(0, 4000);
  const output = [stdout, stderr].filter(Boolean).join("\n") || undefined;
  const files = data.generatedFiles || [];
  const hasDetail = Boolean(fullCommand && (output || files.length > 0)) || running;

  if (!hasDetail) {
    return <ToolRow verb={verb} summary={summary} status={status} />;
  }

  return (
    <ToolRow verb={verb} summary={summary} defaultOpen={false} status={status}>
      <div className="flex flex-col gap-2">
        <ToolShellContent command={fullCommand} output={output} />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <FileCard
                key={f.name}
                filename={f.name}
                filePath={f.relativePath}
                downloadUrl={`/api/files/${f.relativePath.split("/").map((s) => encodeURIComponent(s)).join("/")}`}
              />
            ))}
          </div>
        )}
      </div>
    </ToolRow>
  );
};

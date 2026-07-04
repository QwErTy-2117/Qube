"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileCard } from "./file-card";

export const RunCommandToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  let data: { command?: string; exitCode?: number; stdout?: string; stderr?: string; generatedFiles?: Array<{ name: string; relativePath: string; size: number }> } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const exitCode = data.exitCode ?? 0;
  const succeeded = exitCode === 0;
  const files = data.generatedFiles || [];

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            succeeded
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          <span className={`size-1.5 rounded-full ${succeeded ? "bg-green-500" : "bg-red-500"}`} />
          {succeeded ? "Completed" : "Something went wrong"}
        </span>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <FileCard
              key={f.name}
              filename={f.name}
              filePath={f.relativePath}
              downloadUrl={`/api/files/${f.relativePath}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

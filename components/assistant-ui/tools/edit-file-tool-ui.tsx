"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DiffView } from "./diff-view";
import { FileCard } from "./file-card";

export const EditFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const path = (args as any)?.path || "";
  const oldString = (args as any)?.oldString || "";
  const newString = (args as any)?.newString || "";
  let data: { path?: string; relativePath?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || path;
  const downloadUrl = data.relativePath ? `/api/files/${data.relativePath}` : null;

  const ext = displayPath.split(".").pop()?.toLowerCase();
  const isDownloadable = ["pptx", "docx", "xlsx", "pdf", "csv", "zip", "png", "jpg", "jpeg", "gif", "svg"].includes(ext || "");

  const displayName = displayPath.split("/").pop() || displayPath;

  return (
    <div className="px-3 py-1 text-sm">
      {downloadUrl && isDownloadable && (
        <div className="mb-2">
          <FileCard filename={displayName} downloadUrl={downloadUrl} />
        </div>
      )}
      {displayPath && (
        <div className="mb-2 font-mono text-sm text-muted-foreground">
          {displayPath}
        </div>
      )}
      {data.status === "edited" ? (
        <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Edited
        </div>
      ) : data.status === "failed" ? (
        <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <span className="size-1.5 rounded-full bg-red-500" />
          Edit failed
        </div>
      ) : null}
      {oldString && newString && (
        <div className="mt-2">
          <DiffView oldContent={oldString} newContent={newString} />
        </div>
      )}
    </div>
  );
};

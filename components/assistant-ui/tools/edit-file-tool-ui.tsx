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
  const downloadUrl = data.relativePath ? `/api/files/${data.relativePath.split("/").map((s) => encodeURIComponent(s)).join("/")}` : null;

  const ext = displayPath.split(".").pop()?.toLowerCase();
  const isDownloadable = ["pptx", "ppt", "docx", "doc", "xlsx", "xls", "pdf", "csv", "zip", "png", "jpg", "jpeg", "gif", "svg", "md", "txt", "json", "js", "ts", "tsx", "jsx", "py", "html", "css"].includes(ext || "");

  const displayName = displayPath.split("/").pop() || displayPath;

  // Standalone inline rendering (never inside a collapsed tool group):
  // file card gets breathing room; diff details stay in a bordered block.
  if (!downloadUrl || !isDownloadable) {
    // Non-downloadable edits keep a compact status row (no card to splash).
    if (!data.status && !oldString) return null;
  }
  return (
    <div className="my-3 flex flex-col gap-2 text-sm" data-slot="file-card-inline">
      {downloadUrl && isDownloadable && (
        <FileCard filename={displayName} filePath={data.relativePath || path} downloadUrl={downloadUrl} />
      )}
      {data.status === "edited" && !downloadUrl ? (
        <div className="flex items-center gap-1.5 px-1 text-sm text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          <span className="font-medium">{displayName}</span>
          <span className="text-muted-foreground">edited</span>
        </div>
      ) : data.status === "failed" ? (
        <div className="flex items-center gap-1.5 px-1 text-sm text-red-600 dark:text-red-400">
          <span className="size-1.5 rounded-full bg-red-500" />
          Edit failed
        </div>
      ) : null}
      {oldString && newString && (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <DiffView oldContent={oldString} newContent={newString} />
        </div>
      )}
    </div>
  );
};

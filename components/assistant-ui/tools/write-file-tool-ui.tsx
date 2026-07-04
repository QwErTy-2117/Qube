"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileCard } from "./file-card";

export const WriteFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const filename = (args as any)?.path || "";
  let data: { path?: string; relativePath?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const relativePath = data.relativePath;
  const downloadUrl = relativePath ? `/api/files/${relativePath}` : null;
  const filePath = data.path || filename;

  const ext = filename.split(".").pop()?.toLowerCase();
  const isDownloadable = ["pptx", "docx", "xlsx", "pdf", "csv", "zip", "png", "jpg", "jpeg", "gif", "svg"].includes(ext || "");

  const displayName = filePath.split("/").pop() || filePath;

  if (data.status === "written" && downloadUrl && isDownloadable) {
    return (
      <div className="px-1 py-0.5">
        <FileCard filename={displayName} filePath={filePath} downloadUrl={downloadUrl} />
      </div>
    );
  }

  if (data.status === "written") {
    return (
      <div className="flex items-center gap-1.5 px-1 py-0.5 text-sm text-green-600 dark:text-green-400">
        <span className="size-1.5 rounded-full bg-green-500" />
        <span className="font-medium">{displayName}</span>
        <span className="text-muted-foreground">written</span>
      </div>
    );
  }

  return null;
};

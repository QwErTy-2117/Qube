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

  const ext = filename.split(".").pop()?.toLowerCase();
  const isDownloadable = ["pptx", "docx", "xlsx", "pdf", "csv", "zip", "png", "jpg", "jpeg", "gif", "svg"].includes(ext || "");

  const displayName = filename.split("/").pop() || filename;

  if (data.status === "written" && downloadUrl && isDownloadable) {
    return (
      <div className="px-3 py-1">
        <FileCard filename={displayName} downloadUrl={downloadUrl} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-sm text-green-600 dark:text-green-400">
      <span className="size-1.5 rounded-full bg-green-500" />
      <span>All set!</span>
    </div>
  );
};

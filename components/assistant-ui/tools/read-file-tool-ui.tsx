"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileCard } from "./file-card";
import { ToolRow, ToolFileContent } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ReadFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const filePath = (args as any)?.path || "";
  const running = (status as { type?: string })?.type === "running";
  let data: { path?: string; relativePath?: string; content?: string; lineCount?: number } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.relativePath || data.path || filePath;
  const downloadUrl = data.relativePath ? `/api/files/${data.relativePath.split("/").map((s) => encodeURIComponent(s)).join("/")}` : null;

  const ext = displayPath.split(".").pop()?.toLowerCase();
  const isDownloadable = ["pptx", "ppt", "docx", "doc", "xlsx", "xls", "pdf", "csv", "zip", "png", "jpg", "jpeg", "gif", "svg", "md", "txt", "json", "js", "ts", "tsx", "jsx", "py", "html", "css"].includes(ext || "");

  const displayName = displayPath.split("/").pop() || displayPath;
  const verb = friendlyToolLabel("read_file", args);

  const summary = running && !displayPath ? "…" : displayName;

  // Single detail card only: readable content wins (no FileCard pill on top —
  // the content card carries the path header). Binaries with no content fall
  // back to the FileCard for open/download actions.
  if (data.content) {
    return (
      <ToolRow verb={verb} summary={summary} defaultOpen={false} status={status}>
        <ToolFileContent path={displayPath} content={data.content.slice(0, 8000)} />
      </ToolRow>
    );
  }

  if (downloadUrl && isDownloadable) {
    return (
      <ToolRow verb={verb} summary={summary} defaultOpen={false} status={status}>
        <FileCard filename={displayName} filePath={data.relativePath || filePath} downloadUrl={downloadUrl} />
      </ToolRow>
    );
  }

  return <ToolRow verb={verb} summary={summary} status={status} />;
};

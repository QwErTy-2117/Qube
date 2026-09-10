"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileCard } from "./file-card";

/**
 * Renders the present_file tool call as a bare file card (never wrapped
 * in a tool group) so the agent can place Open/Download exactly where
 * it wants in its reply — in the middle of paragraphs, with breathing
 * room, never stacked on top of the response.
 *
 * Every call renders (no de-duplication): if the agent presents the same
 * file twice, both cards show where they were called. The bottom
 * Changed-files summary still skips presented files to avoid a third copy.
 */
export const ShowFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const argPath = (args as any)?.path || "";
  let data: { relativePath?: string; filename?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const rel = data.relativePath || argPath;

  if (!rel || typeof rel !== "string") return null;
  if ((data as { error?: string }).error) return null;

  const filename = data.filename || rel.split("/").pop() || rel;
  const isExternal = rel.startsWith("/") || rel.startsWith("~");
  const encodePath = (p: string) => p.split("/").map((s) => encodeURIComponent(s)).join("/");
  const downloadUrl = isExternal
    ? `/api/external-files/${encodePath(rel.replace(/^\//, "").replace(/^~\//, ""))}`
    : `/api/files/${encodePath(rel)}`;

  return (
    <div className="my-3 flex flex-col gap-2" data-slot="file-card-inline">
      <FileCard
        filename={filename}
        filePath={isExternal ? undefined : rel}
        downloadUrl={downloadUrl}
      />
    </div>
  );
};

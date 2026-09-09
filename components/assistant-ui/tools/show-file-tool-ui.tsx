"use client";

import { useMemo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import { FileCard } from "./file-card";

/**
 * Renders the present_file tool call as a bare file card (never wrapped
 * in a tool group) so the agent can place Open/Download exactly where
 * it wants in its reply.
 *
 * Each unique file renders exactly once per answer: if the agent calls
 * present_file for the same path again later in the message, the repeat
 * renders nothing (the bottom Changed-files summary covers anything the
 * agent never presented).
 */
export const ShowFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  toolCallId,
}) => {
  const content = useAuiState((s) => s.message.content);
  const argPath = (args as any)?.path || "";
  let data: { relativePath?: string; filename?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const rel = data.relativePath || argPath;

  const isDuplicate = useMemo(() => {
    if (!rel || typeof rel !== "string") return false;
    try {
      const parts = ((content || []) as unknown) as Array<Record<string, unknown>>;
      for (const p of parts) {
        if (!p || p.type !== "tool-call" || (p as { toolName?: string }).toolName !== "present_file") continue;
        if ((p as { toolCallId?: string }).toolCallId === toolCallId) return false; // reached self first
        const pArgs = ((p as { args?: unknown }).args || {}) as Record<string, unknown>;
        let pRel = typeof pArgs.path === "string" ? pArgs.path.trim() : "";
        try {
          const pRes = (p as { result?: unknown }).result;
          const parsed = typeof pRes === "string" ? JSON.parse(pRes) : pRes;
          if (parsed && typeof (parsed as { relativePath?: unknown }).relativePath === "string") {
            pRel = (parsed as { relativePath: string }).relativePath;
          }
        } catch {}
        if (pRel && pRel === rel) return true;
      }
    } catch {}
    return false;
  }, [content, rel, toolCallId]);

  if (!rel || typeof rel !== "string") return null;
  if ((data as { error?: string }).error) return null;
  if (isDuplicate) return null;

  const filename = data.filename || rel.split("/").pop() || rel;
  const isExternal = rel.startsWith("/") || rel.startsWith("~");
  const encodePath = (p: string) => p.split("/").map((s) => encodeURIComponent(s)).join("/");
  const downloadUrl = isExternal
    ? `/api/external-files/${encodePath(rel.replace(/^\//, "").replace(/^~\//, ""))}`
    : `/api/files/${encodePath(rel)}`;

  return (
    <div className="px-1 py-0.5">
      <FileCard
        filename={filename}
        filePath={isExternal ? undefined : rel}
        downloadUrl={downloadUrl}
      />
    </div>
  );
};

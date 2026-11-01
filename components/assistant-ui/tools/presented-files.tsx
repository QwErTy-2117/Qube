"use client";

import { useMemo } from "react";
import { useAuiState } from "@assistant-ui/react";
import { FileCard } from "./file-card";
import { collectPresentedEntries } from "./file-dedupe";
import { extractFileRefsFromText } from "@/components/assistant-ui/md-file-ref";

/**
 * Slim file list pinned to the bottom of an assistant message (after all
 * text): one rounded pill per deliverable from present_file calls, plus
 * [file:] markers the agent wrote instead of calling present_file.
 * Each path renders at most once. Renders nothing when empty.
 */
export function PresentedFiles() {
  const content = useAuiState((s) => s.message.content);

  const entries = useMemo(() => {
    const parts = ((content || []) as unknown) as Array<Record<string, unknown>>;
    const textRefs: string[] = [];
    for (const p of parts) {
      if (p && p.type === "text" && typeof (p as { text?: unknown }).text === "string") {
        for (const ref of extractFileRefsFromText((p as { text: string }).text)) {
          if (!textRefs.includes(ref)) textRefs.push(ref);
        }
      }
    }
    return collectPresentedEntries(content, textRefs);
  }, [content]);

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 flex max-w-[380px] flex-col gap-2" data-slot="presented-files">
      {entries.map((e) => (
        <FileCard
          key={e.key}
          filename={e.filename}
          filePath={e.filePath}
          downloadUrl={e.downloadUrl}
        />
      ))}
    </div>
  );
}

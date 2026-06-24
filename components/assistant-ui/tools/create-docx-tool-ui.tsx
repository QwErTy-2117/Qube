"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileTextIcon } from "lucide-react";

export const CreateDocxToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const title = (args as any)?.title || "";
  const sectionCount = (args as any)?.sections?.length || 0;
  let data: { path?: string; title?: string; sectionCount?: number } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <FileTextIcon className="size-4" />
        <span>Create Document</span>
      </div>
      {(data.title || title) && (
        <div className="mb-1 text-xs font-medium">{data.title || title}</div>
      )}
      <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
        <span>File: {data.path || (args as any)?.filename || ""}</span>
        <span>
          Sections: {data.sectionCount ?? sectionCount}
        </span>
      </div>
      {(data.sectionCount ?? sectionCount) > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Document created successfully
        </div>
      )}
    </div>
  );
};

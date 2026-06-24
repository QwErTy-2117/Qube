"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { PresentationIcon } from "lucide-react";

export const CreatePptxToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const title = (args as any)?.title || "";
  const slideCount = (args as any)?.slides?.length || 0;
  let data: { path?: string; title?: string; slides?: number } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <PresentationIcon className="size-4" />
        <span>Create Presentation</span>
      </div>
      {(data.title || title) && (
        <div className="mb-1 text-xs font-medium">{data.title || title}</div>
      )}
      <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
        <span>File: {data.path || (args as any)?.filename || ""}</span>
        <span>Slides: {data.slides ?? slideCount}</span>
      </div>
      {(data.slides ?? slideCount) > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Presentation created successfully
        </div>
      )}
    </div>
  );
};

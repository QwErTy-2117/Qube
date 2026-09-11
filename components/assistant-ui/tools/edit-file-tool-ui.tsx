"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DiffView } from "./diff-view";

/**
 * edit_file never renders a file card: cards live only in the slim
 * PresentedFiles list at the bottom of the message (built from
 * present_file calls). Only diff/status rows render here, inside the
 * collapsed tool group.
 */
export const EditFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const path = (args as any)?.path || "";
  const oldString = (args as any)?.oldString || "";
  const newString = (args as any)?.newString || "";
  let data: { path?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || path;

  const displayName = displayPath.split("/").pop() || displayPath;

  if (!data.status && !oldString) return null;
  const hasDiff = !!(oldString && newString);
  const hasFailure = data.status === "failed";
  const hasStatusRow = data.status === "edited";
  if (!hasDiff && !hasFailure && !hasStatusRow) return null;
  return (
    <div className="my-3 flex flex-col gap-2 text-sm" data-slot="file-card-inline">
      {data.status === "edited" ? (
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

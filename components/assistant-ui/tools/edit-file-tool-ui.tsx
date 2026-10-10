"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DiffView } from "./diff-view";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

/**
 * Screenshot style: minimal row expanding into a bordered diff card.
 * Collapsed by default; PresentedFiles still owns bottom cards.
 */
export const EditFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const path = (args as any)?.path || "";
  const oldString = (args as any)?.oldString || "";
  const newString = (args as any)?.newString || "";
  const running = (status as { type?: string })?.type === "running";
  let data: { path?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || path;
  const displayName = displayPath.split("/").pop() || displayPath || "…";
  const verb = friendlyToolLabel("edit_file", args);

  const hasDiff = !!(oldString && newString);
  if (!hasDiff && !data.status && !running) {
    return <ToolRow verb={verb} summary={displayName} status={status} result={result} />;
  }
  if (!hasDiff) {
    return <ToolRow verb={verb} summary={displayName} status={status} result={result} />;
  }
  return (
    <ToolRow verb={verb} summary={displayName} defaultOpen={false} status={status} result={result}>
      <DiffView oldContent={oldString} newContent={newString} hideHeader className="rounded-none border-0 bg-transparent" />
    </ToolRow>
  );
};

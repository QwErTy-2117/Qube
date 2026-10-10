"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow, ToolFileContent } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

/**
 * Screenshot style: minimal row (bold verb + muted filename) expanding
 * into a bordered file-content card. Collapsed by default so intermediate
 * builder scripts stay tucked away; PresentedFiles still owns bottom cards.
 */
export const WriteFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const filename = (args as any)?.path || "";
  const content = typeof (args as any)?.content === "string" ? (args as any).content : "";
  const running = (status as { type?: string })?.type === "running";
  let data: { status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayName = (filename as string).split("/").pop() || (filename as string) || "…";
  const verb = friendlyToolLabel("write_file", args);

  if (!content) {
    return <ToolRow verb={verb} summary={running ? "…" : displayName} status={status} />;
  }

  return (
    <ToolRow verb={verb} summary={displayName} defaultOpen={false} status={status}>
      <ToolFileContent path={filename} content={content.slice(0, 8000)} />
    </ToolRow>
  );
};

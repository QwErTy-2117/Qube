"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const DeleteFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const filePath = (args as any)?.path || "";
  let data: { path?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || filePath;
  const displayName = displayPath.split("/").pop() || displayPath || "…";

  return (
    <ToolRow verb={friendlyToolLabel("delete_file", args)} summary={displayName} status={status} />
  );
};

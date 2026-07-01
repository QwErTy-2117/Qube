"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const WriteFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const filename = (args as any)?.path || "";
  let data: { path?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || filename;

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {displayPath && (
        <div className="mb-2 font-mono text-xs text-muted-foreground">
          {displayPath}
        </div>
      )}
      {data.status === "written" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Successfully written
        </div>
      )}
    </div>
  );
};

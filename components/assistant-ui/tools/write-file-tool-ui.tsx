"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

/**
 * write_file never renders a file card: cards live only in the slim
 * PresentedFiles list at the bottom of the message (built from
 * present_file calls). This keeps intermediate builder scripts
 * (e.g. create_doc.py used to generate a .docx) hidden inside the
 * collapsed tool group instead of splashed as cards on top of the reply.
 */
export const WriteFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const filename = (args as any)?.path || "";
  let data: { status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayName = (filename as string).split("/").pop() || (filename as string);

  if (data.status === "written") {
    return (
      <div className="my-2 flex items-center gap-1.5 px-1 text-sm text-green-600 dark:text-green-400">
        <span className="size-1.5 rounded-full bg-green-500" />
        <span className="font-medium">{displayName}</span>
        <span className="text-muted-foreground">written</span>
      </div>
    );
  }

  return null;
};

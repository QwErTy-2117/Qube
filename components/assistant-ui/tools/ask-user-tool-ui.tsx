"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { HelpCircleIcon } from "lucide-react";

export const AskUserToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const question = (args as any)?.question || "";
  const options = (args as any)?.options || [];
  let data: { question?: string; answer?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-blue-50/50 px-3 py-2 text-sm dark:bg-blue-950/20">
      <div className="mb-2 flex items-center gap-2 font-medium text-blue-600 dark:text-blue-400">
        <HelpCircleIcon className="size-4" />
        <span>Question for you</span>
      </div>
      <div className="mb-2 rounded-md bg-background p-3 text-sm">
        {data.question || question}
      </div>
      {options.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {options.map((opt: string) => (
            <span
              key={opt}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {opt}
            </span>
          ))}
        </div>
      )}
      {data.answer ? (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Your response: {data.answer}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Waiting for your response...
        </div>
      )}
    </div>
  );
};

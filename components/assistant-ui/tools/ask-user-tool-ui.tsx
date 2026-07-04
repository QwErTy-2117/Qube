"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { HelpCircleIcon, CheckIcon } from "lucide-react";

export const AskUserToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const question = (args as any)?.question || "";
  const options = (args as any)?.options || [];
  const multiple = (args as any)?.multiple || false;

  let data: { question?: string; options?: string[]; multiple?: boolean; answer?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayQuestion = data.question || question;
  const displayOptions = data.options || options;
  const displayMultiple = data.multiple ?? multiple;
  const answer = data.answer;

  return (
    <div className="rounded-xl border border-border/60 bg-background px-4 py-3 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <HelpCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground">{displayQuestion}</p>
        </div>
      </div>

      {displayOptions.length > 0 && !answer && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {displayOptions.map((opt: string) => (
            <span
              key={opt}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 text-sm font-medium text-muted-foreground"
            >
              {displayMultiple && (
                <span className="flex size-4 items-center justify-center rounded-sm border border-muted-foreground/30" />
              )}
              {opt}
            </span>
          ))}
        </div>
      )}

      {answer && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm">
          <CheckIcon className="size-4 text-green-500" />
          <span className="text-muted-foreground">{answer}</span>
        </div>
      )}

      {!answer && displayOptions.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          Awaiting your input
        </p>
      )}
    </div>
  );
};

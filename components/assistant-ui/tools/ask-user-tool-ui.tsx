"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

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
    <div className="space-y-2 px-3 py-1.5 text-sm text-foreground/80">
      <p>{data.question || question}</p>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt: string) => (
            <span
              key={opt}
              className="rounded-md border border-border/50 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground"
            >
              {opt}
            </span>
          ))}
        </div>
      )}
      {data.answer ? (
        <p className="text-xs text-muted-foreground">
          Response: {data.answer}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <span className="size-1 rounded-full bg-muted-foreground/40" />
          Awaiting your input
        </p>
      )}
    </div>
  );
};

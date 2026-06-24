"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { GlobeIcon } from "lucide-react";

export const WebSearchToolUI: ToolCallMessagePartComponent = ({
  argsText,
  result,
}) => {
  let args: { query?: string } = {};
  let data: { results?: Array<{ title: string; snippet: string; url: string }> } = {};
  try {
    args = JSON.parse(argsText || "{}");
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <GlobeIcon className="size-4" />
        <span>Web Search</span>
      </div>
      {args.query && (
        <div className="mb-3 rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
          {args.query}
        </div>
      )}
      {data.results && data.results.length > 0 ? (
        <div className="flex flex-col gap-2">
          {data.results.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              {r.url && (
                <img
                  src={`https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=16`}
                  alt=""
                  className="mt-0.5 size-4 shrink-0 rounded"
                />
              )}
              <div className="min-w-0">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {r.title || r.url}
                  </a>
                ) : (
                  <span className="font-medium">{r.title}</span>
                )}
                {r.snippet && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {r.snippet}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No results found.</p>
      )}
    </div>
  );
};

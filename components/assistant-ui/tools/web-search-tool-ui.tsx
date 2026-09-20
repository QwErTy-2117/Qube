"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SearchIcon, GlobeIcon } from "lucide-react";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export const WebSearchToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const query = (args as any)?.query || "";
  const running = (status as { type?: string })?.type === "running";
  let data: {
    results?: Array<{ title: string; snippet: string; url: string }>;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const results = Array.isArray(data.results) ? data.results : [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/20 text-sm">
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
          {query || "Searching web"}
        </span>
        {running ? (
          <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">working…</span>
        ) : results.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {results.length} source{results.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {results.length > 0 ? (
        <div className="flex flex-col divide-y divide-border/60 px-3">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-2.5 py-2">
              {r.url ? (
                <img
                  src={`https://www.google.com/s2/favicons?domain=${domainOf(r.url)}&sz=32`}
                  alt=""
                  loading="lazy"
                  className="size-4 shrink-0 rounded-full bg-muted"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <GlobeIcon className="size-4 shrink-0 text-muted-foreground/60" />
              )}
              <div className="min-w-0 flex-1">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-medium text-foreground/90 hover:underline"
                    title={r.title || r.url}
                  >
                    {r.title || r.url}
                  </a>
                ) : (
                  <span className="block truncate font-medium">{r.title}</span>
                )}
                {r.snippet && (
                  <p className="truncate text-xs text-muted-foreground">
                    {r.snippet}
                  </p>
                )}
              </div>
              {r.url && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {domainOf(r.url)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : !running ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No results found.</p>
      ) : null}
    </div>
  );
};

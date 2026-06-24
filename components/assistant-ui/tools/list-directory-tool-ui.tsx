"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FolderIcon, FileIcon, FolderOpenIcon } from "lucide-react";

export const ListDirectoryToolUI: ToolCallMessagePartComponent = ({
  argsText,
  result,
}) => {
  let data: {
    path?: string;
    items?: Array<{ name: string; type: string; size: number }>;
    totalItems?: number;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const items = data.items || [];

  const treeLines = buildTreeLines(items);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <FolderOpenIcon className="size-4" />
        <span>Directory Listing</span>
      </div>
      {data.path && (
        <div className="mb-2 font-mono text-xs text-muted-foreground">
          {data.path}
          {data.totalItems !== undefined && (
            <span className="ml-2 text-muted-foreground/60">
              ({data.totalItems} items)
            </span>
          )}
        </div>
      )}
      <div className="rounded-md border border-border bg-background p-2 font-mono text-xs">
        {treeLines.length > 0 ? (
          treeLines.map((line, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              {line.type === "directory" ? (
                <FolderIcon className="size-3.5 shrink-0 text-amber-500" />
              ) : (
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
              )}
              <span
                className={
                  line.type === "directory"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }
              >
                {line.name}
              </span>
              {line.size > 0 && (
                <span className="ml-auto text-muted-foreground/50">
                  {formatSize(line.size)}
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="text-muted-foreground/60">(empty directory)</div>
        )}
      </div>
    </div>
  );
};

function buildTreeLines(
  items: Array<{ name: string; type: string; size: number }>,
) {
  const dirs = items.filter((i) => i.type === "directory");
  const files = items.filter((i) => i.type !== "directory");
  return [
    ...dirs.map((d) => ({ name: d.name + "/", type: "directory" as const, size: 0 })),
    ...files.map((f) => ({ name: f.name, type: "file" as const, size: f.size })),
  ];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FolderIcon, FileIcon } from "lucide-react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ListDirectoryToolUI: ToolCallMessagePartComponent = ({
  args,
  argsText,
  result,
  status,
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
  const argPath = (args as any)?.path || "";
  const displayPath = data.path || argPath || "";
  const displayName = displayPath.split("/").pop() || displayPath || "…";

  const treeLines = buildTreeLines(items);

  const summary =
    data.totalItems !== undefined
      ? `${displayName} (${data.totalItems} items)`
      : displayName;

  if (treeLines.length === 0) {
    return (
      <ToolRow verb={friendlyToolLabel("list_directory", args)} summary={summary} status={status} />
    );
  }

  return (
    <ToolRow
      verb={friendlyToolLabel("list_directory", args)}
      summary={summary}
      defaultOpen={false}
      status={status}
    >
      <div className="font-mono text-xs">
        {treeLines.map((line, i) => (
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
        ))}
      </div>
    </ToolRow>
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

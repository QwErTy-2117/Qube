"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

function getMCPResult(result: unknown): any {
  try {
    if (typeof result === "string") return JSON.parse(result);
    return result;
  } catch {
    return null;
  }
}

export const AppStateToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const data = getMCPResult(result);
  const content = data?.content || [];
  const imageItem = content.find((c: any) => c.type === "image");
  const textItem = content.find((c: any) => c.type === "text");
  const app = (args as any)?.app || "";

  return (
    <div className="my-2 rounded-xl border border-border/60 overflow-hidden">
      <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-medium flex items-center gap-2">
        <span>📷 App State</span>
        {app && <span className="text-muted-foreground/60">— {app}</span>}
      </div>
      {imageItem ? (
        <img
          src={`data:${imageItem.mimeType || "image/png"};base64,${imageItem.data}`}
          alt={`${app} screenshot`}
          className="w-full h-auto"
        />
      ) : (
        <div className="px-3 py-4 text-xs text-muted-foreground/40 text-center">
          No screenshot available
        </div>
      )}
      {textItem && (
        <details className="border-t border-border/60">
          <summary className="px-3 py-1.5 text-xs text-muted-foreground cursor-pointer hover:bg-muted/20">
            Accessibility Tree
          </summary>
          <pre className="px-3 py-2 text-xs text-muted-foreground/80 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
            {textItem.text}
          </pre>
        </details>
      )}
    </div>
  );
};

export const ListAppsToolUI: ToolCallMessagePartComponent = ({ result }) => {
  const data = getMCPResult(result);
  const content = data?.content || [];
  const textItem = content.find((c: any) => c.type === "text");
  const apps = textItem?.text || "";

  return (
    <div className="my-1 rounded-xl border border-border/60 overflow-hidden">
      <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-medium">
        📋 Running Apps
      </div>
      {apps ? (
        <pre className="px-3 py-2 text-xs text-muted-foreground/80 whitespace-pre-wrap font-mono">
          {apps}
        </pre>
      ) : (
        <div className="px-3 py-4 text-xs text-muted-foreground/40 text-center">
          No apps found
        </div>
      )}
    </div>
  );
};

export const ComputerToolUI: ToolCallMessagePartComponent = ({ toolName, args, result }) => {
  const a = args as Record<string, unknown> || {};
  const detailLines: string[] = [];
  if (a.app) detailLines.push(`app: ${a.app}`);
  if (a.element_index !== undefined) detailLines.push(`element: ${a.element_index}`);
  if (a.x !== undefined && a.y !== undefined) detailLines.push(`(${a.x}, ${a.y})`);
  if (a.text) detailLines.push(`"${(a.text as string).slice(0, 50)}"`);
  if (a.key) detailLines.push(`[${a.key}]`);
  if (a.mouse_button && a.mouse_button !== "left") detailLines.push(`button: ${a.mouse_button}`);
  if (a.direction) detailLines.push(`${a.direction} x${a.amount || 1}`);
  if (a.from_x !== undefined) detailLines.push(`${a.from_x},${a.from_y} → ${a.to_x},${a.to_y}`);

  return (
    <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-md uppercase tracking-wider">
        {toolName}
      </span>
      {detailLines.length > 0 && (
        <span className="truncate">{detailLines.join(" | ")}</span>
      )}
    </div>
  );
};

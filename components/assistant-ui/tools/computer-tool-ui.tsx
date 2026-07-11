"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ComputerScreenshotToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const windowTitle = (args as any)?.windowTitle;
  let imageSrc = "";
  let errorMsg = "";
  try {
    const data = typeof result === "string" ? JSON.parse(result) : result;
    if (data?.base64) imageSrc = `data:image/png;base64,${data.base64}`;
    if (data?.error) errorMsg = data.message || "Screenshot failed";
  } catch {}

  return (
    <div className="my-2 rounded-xl border border-border/60 overflow-hidden">
      <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-medium flex items-center gap-2">
        <span>📷 Screenshot</span>
        {windowTitle && <span className="text-muted-foreground/60">— {windowTitle}</span>}
      </div>
      {imageSrc ? (
        <img src={imageSrc} alt="Screenshot" className="w-full h-auto" />
      ) : errorMsg ? (
        <div className="px-3 py-4 text-xs text-red-500/80 text-center">
          {errorMsg}
        </div>
      ) : result ? (
        <div className="px-3 py-4 text-xs text-muted-foreground/60 text-center">
          Processing screenshot...
        </div>
      ) : (
        <div className="px-3 py-4 text-xs text-muted-foreground/40 text-center">
          Capturing screenshot...
        </div>
      )}
    </div>
  );
};

export const ComputerToolUI: ToolCallMessagePartComponent = ({ toolName, args, result }) => {
  const name = toolName.replace("computer_", "").replace(/_/g, " ");
  const a = args as Record<string, unknown> || {};
  const detailLines: string[] = [];
  if (a.x !== undefined && a.y !== undefined) detailLines.push(`(${a.x}, ${a.y})`);
  if (a.text) detailLines.push(`"${(a.text as string).slice(0, 50)}"`);
  if (a.keys) detailLines.push(`[${a.keys}]`);
  if (a.button && a.button !== "left") detailLines.push(`button: ${a.button}`);
  if (a.direction) detailLines.push(`${a.direction} x${a.amount || 1}`);
  if (a.fromX !== undefined) detailLines.push(`${a.fromX},${a.fromY} → ${a.toX},${a.toY}`);

  return (
    <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-md uppercase tracking-wider">
        {name}
      </span>
      {detailLines.length > 0 && (
        <span className="truncate">{detailLines.join(" | ")}</span>
      )}
    </div>
  );
};

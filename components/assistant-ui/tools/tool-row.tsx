"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, FileIcon, Loader2Icon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

/**
 * Shared tool-call card — the same rounded-rectangle look for every tool.
 * (Connectors, files, shell, web, sessions, …).
 *
 * Header: playful verb + muted inline summary + run state (spinner / check)
 * on the right. When `children` are present the whole header is a toggle
 * and the card expands to reveal the detail below — same card, expandable.
 */
export function ToolRow({
  verb,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
  status,
  result,
}: {
  verb: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  className?: string;
  status?: { type?: string };
  /** Raw tool result, when the caller has it. A present result is proof the
   *  tool finished — it forces the row to rest/check even if the part
   *  status is stuck on "running" (e.g. after a steered/aborted turn). */
  result?: unknown;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;
  const setOpen = (v: boolean) => {
    if (!isControlled) setUncontrolled(v);
    onOpenChange?.(v);
  };
  const hasDetail = children !== undefined && children !== null;
  // A part can be left behind in "running" when its run is aborted
  // (e.g. user steers mid-tool: the old turn is killed, the new turn
  // redoes the work). Such a part is stale — not executing — so it must
  // never spin: the spinner requires the part AND its owning message AND
  // the thread to all still be running. A delivered result is even
  // stronger proof of completion and forces the check instead.
  const hasResult = result !== undefined && result !== null;
  let messageStatus: unknown;
  try {
    messageStatus = useAuiState((s) => (s as any)?.message?.status?.type);
  } catch {
    messageStatus = undefined;
  }
  // Unknown message state preserves the old behavior (spin); only a
  // definitively finished message stills a "running" part.
  const messageRunning = messageStatus == null || messageStatus === "running";
  let threadRunning = true;
  try {
    threadRunning = useAuiState(
      (s) => (s as any)?.thread?.isRunning !== false,
    );
  } catch {
    threadRunning = true;
  }
  const isRunning =
    status?.type === "running" &&
    messageRunning &&
    threadRunning &&
    !hasResult;
  const isComplete = status?.type === "complete" || hasResult;
  return (
    <div data-slot="tool-row" className={cn("mt-2 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm", className)}>
      <button
        type="button"
        onClick={() => {
          if (hasDetail) setOpen(!open);
        }}
        aria-expanded={hasDetail ? open : undefined}
        className={cn(
          "group flex w-full items-center gap-2 text-left",
          hasDetail ? "cursor-pointer" : "cursor-default"
        )}
      >
        <span className="shrink-0 text-xs font-medium text-foreground/80">{verb}</span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-[11px] font-normal text-muted-foreground/60">
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {isRunning && <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground/40" />}
        {isComplete && <CheckIcon className="size-3.5 shrink-0 text-emerald-500" />}
        {hasDetail && (
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 self-center text-muted-foreground/50 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        )}
      </button>
      {hasDetail && open && <div className="mt-2 border-t border-border/50 pt-2">{children}</div>}
    </div>
  );
}

export function ToolCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="tool-card"
      className={cn(
        "overflow-hidden rounded-lg border border-border/70 bg-background",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ToolCardHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border/60 px-3 py-2 text-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ToolFileContent({
  path,
  content,
  maxLines = 50,
}: {
  path?: string;
  content: string;
  maxLines?: number;
}) {
  const lines = content.split("\n").slice(0, maxLines);
  // Flat: no inner card — the row itself is the container, content sits
  // directly under the header divider.
  return (
    <div className="font-mono text-[13px] leading-6">
      {path && (
        <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
          <FileIcon className="size-3.5 shrink-0 text-blue-500" aria-hidden />
          <span
            className="min-w-0 flex-1 truncate text-[13px]"
            title={path}
          >
            {path.startsWith("/") ? path : `/${path}`}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-4">
            <span className="w-4 shrink-0 select-none text-right tabular-nums text-muted-foreground/40">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-muted-foreground">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ToolShellContent({
  command,
  output,
}: {
  command?: string;
  output?: string;
}) {
  // Flat: no inner card — same as file content.
  return (
    <div className="font-mono text-[13px] leading-6">
      {command && (
        <div className="whitespace-pre-wrap break-words text-foreground/90">
          <span className="mr-2 select-none text-muted-foreground">$</span>
          {command}
        </div>
      )}
      {command && output ? <div className="h-2" /> : null}
      {output && (
        <div className="whitespace-pre-wrap break-words text-muted-foreground">
          {output}
        </div>
      )}
    </div>
  );
}

export function baseName(p: string): string {
  if (!p) return "";
  return p.split("/").pop() || p;
}

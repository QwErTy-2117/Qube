"use client";

import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared loading / error / empty states for every artifact viewer. */
export function ArtifactLoading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex h-full min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center", className)}
    >
      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="w-full max-w-xs space-y-2" aria-hidden="true">
        <div className="h-2.5 animate-pulse rounded-full bg-muted" />
        <div className="h-2.5 w-4/5 animate-pulse rounded-full bg-muted/80" />
        <div className="h-2.5 w-3/5 animate-pulse rounded-full bg-muted/60" />
      </div>
    </div>
  );
}

export function ArtifactError({
  title = "Couldn’t open this file",
  message,
  action,
  className,
}: {
  title?: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex h-full min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center", className)}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <AlertTriangleIcon className="size-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && (
        <p className="max-w-[340px] text-xs leading-relaxed break-words text-muted-foreground">{message}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

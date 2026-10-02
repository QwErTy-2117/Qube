"use client";

import { useEffect, useState, useCallback } from "react";

type PermissionRequest = {
  requestId: string;
  toolName: string;
  description: string;
  args: Record<string, unknown>;
};

export function usePermissionPoller(threadId?: string) {
  const [pending, setPending] = useState<PermissionRequest | null>(null);

  const check = useCallback(async () => {
    try {
      const params = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
      const res = await fetch(`/api/permission/pending${params}`);
      const data = await res.json();
      if (data.pending && data.pending.length > 0) {
        setPending(data.pending[0]);
        return;
      }
      setPending(null);
    } catch {
      setPending(null);
    }
  }, [threadId]);

  useEffect(() => {
    const interval = setInterval(check, 500);
    check();
    return () => clearInterval(interval);
  }, [check]);

  const respond = useCallback(
    async (approved: boolean, always?: boolean) => {
      if (!pending) return;
      try {
        await fetch("/api/permission/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: pending.requestId, approved, ...(always ? { always: true } : {}) }),
        });
      } catch {}
      setPending(null);
    },
    [pending],
  );

  return { pending, respond, clear: () => setPending(null) };
}

export function PermissionBar({
  pending,
  onRespond,
}: {
  pending: PermissionRequest;
  onRespond: (approved: boolean, always?: boolean) => void;
}) {
  const commandArg = pending.args?.command as string | undefined;
  const rawPath =
    (pending.args?.path as string) ||
    (pending.args?.filepath as string) ||
    (pending.args?.cwd as string) ||
    "";

  // Muse Sentinel parity: connector / delete / destructive actions have no
  // directory scope — "Allow always" only makes sense for file paths.
  const isConnectorAction =
    !rawPath && !commandArg && !/^(read_file|write_file|edit_file|delete_file|list_directory|run_command|present_file|open_path)$/.test(pending.toolName);
  const isDeleteOrDestructive =
    pending.toolName === "delete_file" ||
    /delete|send|create|post|publish|purchase/i.test(pending.toolName) ||
    /Delete file|Send email|Post a message|Make a purchase|Delete in/i.test(pending.description || "");

  // Mirror backend scopeDirForPath: show containing directory + /* so
  // "Allow always" scope is obvious (e.g. /home/luca/.config/opencode/*).
  const scopePattern = (() => {
    if (!rawPath) return "";
    let p = rawPath.trim();
    // Strip trailing file-like segment (heuristic, no fs access here)
    // e.g. /a/b/config.json -> /a/b/*, /a/b/ -> /a/b/*
    p = p.replace(/\/+$/, "");
    const last = p.split("/").pop() ?? "";
    if (last.includes(".") && !last.startsWith(".")) {
      p = p.split("/").slice(0, -1).join("/") || "/";
    }
    if (p.endsWith("/*")) return p;
    if (p === "") return "";
    return `${p}/*`;
  })();

  const title = isDeleteOrDestructive ? "Approval needed — sensitive action paused" : "Permission required";
  const subtitle =
    pending.description || "Access files outside the project directory";

  // Short audit preview of the blocked call (Muse shows what it planned).
  const argsPreview = (() => {
    try {
      const a = { ...(pending.args || {}) } as Record<string, any>;
      if (typeof a.content === "string" && a.content.length > 400) a.content = `${a.content.slice(0, 400)}…`;
      if (typeof a.newString === "string" && a.newString.length > 200) a.newString = `${a.newString.slice(0, 200)}…`;
      const s = JSON.stringify(a);
      if (s === "{}") return "";
      return s.slice(0, 320);
    } catch {
      return "";
    }
  })();

  return (
    <div className="w-full overflow-hidden rounded-xl border border-amber-500/30 bg-popover text-popover-foreground shadow-lg dark:shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center text-amber-500">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </span>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </p>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {pending.toolName}
          </span>
        </div>
        <p className="mt-2.5 text-sm leading-6 text-foreground/90">{subtitle}</p>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          Qube paused before doing this — nothing was sent, deleted, or changed yet. Review below, then allow once or deny.
        </p>
        {scopePattern && (
          <p className="mt-1 truncate font-mono text-[13px] leading-6 text-muted-foreground/80">
            {scopePattern}
          </p>
        )}
        {commandArg && (
          <p className="mt-1 truncate font-mono text-[12px] leading-5 text-muted-foreground/70">
            $ {commandArg.slice(0, 300)}
          </p>
        )}
        {argsPreview && !commandArg && (
          <p className="mt-1 truncate font-mono text-[12px] leading-5 text-muted-foreground/70">
            {argsPreview}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={() => onRespond(false)}
          className="h-8 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Deny
        </button>
        {!isConnectorAction && !isDeleteOrDestructive && (
          <button
            type="button"
            onClick={() => onRespond(true, true)}
            title="Always allow this directory (saved in Preferences → Allowed directories)"
            className="h-8 rounded-lg border border-input bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Allow always
          </button>
        )}
        <button
          type="button"
          onClick={() => onRespond(true)}
          className="h-8 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Allow once
        </button>
      </div>
    </div>
  );
}

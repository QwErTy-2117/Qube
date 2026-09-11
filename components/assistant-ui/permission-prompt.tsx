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

  const title = "Permission required";
  const subtitle =
    pending.description || "Access files outside the project directory";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-[#0e0e0e] text-neutral-100 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#facc15"
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
          <p className="text-[15px] font-semibold tracking-tight text-white">
            {title}
          </p>
        </div>
        <p className="mt-2.5 text-sm leading-6 text-neutral-300">{subtitle}</p>
        {scopePattern && (
          <p className="mt-1 truncate font-mono text-[13px] leading-6 text-neutral-500">
            {scopePattern}
          </p>
        )}
        {commandArg && (
          <p className="mt-1 truncate font-mono text-[12px] leading-5 text-neutral-600">
            $ {commandArg.slice(0, 300)}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-neutral-800/80 bg-[#131313] px-3 py-2">
        <button
          type="button"
          onClick={() => onRespond(false)}
          className="h-8 rounded-lg px-3 text-sm font-medium text-neutral-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => onRespond(true, true)}
          title="Always allow this directory (saved in Preferences → Allowed directories)"
          className="h-8 rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800 hover:text-white"
        >
          Allow always
        </button>
        <button
          type="button"
          onClick={() => onRespond(true)}
          className="h-8 rounded-lg bg-white px-3.5 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
        >
          Allow once
        </button>
      </div>
    </div>
  );
}

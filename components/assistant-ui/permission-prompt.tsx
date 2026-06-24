"use client";

import { useEffect, useState, useCallback } from "react";
import { ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    async (approved: boolean) => {
      if (!pending) return;
      try {
        await fetch("/api/permission/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: pending.requestId, approved }),
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
  onRespond: (approved: boolean) => void;
}) {
  const commandArg = pending.args?.command as string | undefined;
  const pathArg =
    (pending.args?.path as string) ||
    (pending.args?.filepath as string) ||
    "";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-800/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Permission Required
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
            {pending.description}
          </p>
          {commandArg && (
            <pre className="mt-2 overflow-auto rounded-md bg-amber-100/80 p-2 font-mono text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              $ {commandArg}
            </pre>
          )}
          {pathArg && (
            <pre className="mt-2 overflow-auto rounded-md bg-amber-100/80 p-2 font-mono text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              {pathArg}
            </pre>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 self-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRespond(false)}
          className="h-8 gap-1.5 rounded-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800/50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <ShieldXIcon className="size-3.5" />
          Deny
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => onRespond(true)}
          className="h-8 gap-1.5 rounded-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
        >
          <ShieldCheckIcon className="size-3.5" />
          Allow
        </Button>
      </div>
    </div>
  );
}

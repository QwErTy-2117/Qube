"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Heart, AlertCircle } from "lucide-react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

function safeParse(s: unknown): any {
  if (typeof s === "string") try { return JSON.parse(s); } catch { return null; }
  return s;
}

export const UpdateHeartbeatToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const a = (args || {}) as any;
  const r = safeParse(result);
  const isError = r?.error;

  return (
    <ToolRow
      verb={friendlyToolLabel("update_heartbeat", args)}
      summary={
        a.interval_minutes
          ? `Every ${a.interval_minutes} minutes`
          : isError
            ? "failed"
            : "saved for next chat"
      }
      status={status}
      defaultOpen={false}
    >
      <div className="flex items-start gap-2 text-sm">
        {isError ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <Heart className="mt-0.5 size-4 shrink-0 text-rose-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">Heartbeat Updated</div>
          {a.instructions && (
            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {a.instructions}
            </div>
          )}
          {isError && (
            <div className="text-xs text-destructive mt-1">{r.error}</div>
          )}
          {r?.message && !isError && (
            <div className="text-xs text-muted-foreground mt-1">{r.message}</div>
          )}
        </div>
      </div>
    </ToolRow>
  );
};

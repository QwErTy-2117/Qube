"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SiGoogle } from "react-icons/si";
import { Loader2Icon } from "lucide-react";

function isGoogleTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower.startsWith("search_email") || lower.startsWith("send_email")
    || lower.startsWith("list_calendar") || lower.startsWith("create_calendar")
    || lower.startsWith("search_drive");
}

function toolLabel(toolName: string): string {
  const map: Record<string, string> = {
    search_emails: "Search Emails",
    send_email: "Send Email",
    list_calendar_events: "List Calendar Events",
    create_calendar_event: "Create Calendar Event",
    search_drive: "Search Drive",
  };
  return map[toolName] || toolName;
}

export const ToolFallback: ToolCallMessagePartComponent = ({ toolName, status }) => {
  const isRunning = status?.type === "running";
  const google = isGoogleTool(toolName);

  if (google) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-3 text-sm flex items-center gap-3">
        <div className="size-5 flex items-center justify-center shrink-0" style={{ color: "#4285F4" }}>
          <SiGoogle className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground/90">{toolLabel(toolName)}</div>
          <div className="text-[11px] text-muted-foreground/60">
            {isRunning ? "Working..." : "Done"}
          </div>
        </div>
        {isRunning && (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground/40 shrink-0" />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{toolName}</div>
    </div>
  );
};

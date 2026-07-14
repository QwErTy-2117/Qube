"use client";

import { useState, useEffect, useCallback } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { Loader2Icon, CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONNECTOR_PREFIXES: Record<string, { id: string; name: string }> = {
  linear: { id: "linear", name: "Linear" },
  jira: { id: "atlassian", name: "Jira" },
  trello: { id: "trello", name: "Trello" },
  airtable: { id: "airtable", name: "Airtable" },
  notion: { id: "notion", name: "Notion" },
  slack: { id: "slack", name: "Slack" },
  github: { id: "github", name: "GitHub" },
  gmail: { id: "google", name: "Gmail" },
  googlecalendar: { id: "google", name: "Google Calendar" },
  googledrive: { id: "google", name: "Google Drive" },
  hubspot: { id: "hubspot", name: "HubSpot" },
  asana: { id: "asana", name: "Asana" },
  dropbox: { id: "dropbox", name: "Dropbox" },
};

const COLORS: Record<string, string> = {
  linear: "#5E6AD2", atlassian: "#0052CC", trello: "#0052CC",
  airtable: "#FFBF00", notion: "currentColor", slack: "#4A154B",
  github: "currentColor", google: "#4285F4", hubspot: "#FF7A59",
  asana: "#F06A6A", dropbox: "#0061FF",
};

function getMeta(toolName: string): { id: string; name: string } | null {
  const lower = toolName.toLowerCase();
  for (const [prefix, meta] of Object.entries(CONNECTOR_PREFIXES)) {
    if (lower.startsWith(prefix)) return meta;
  }
  return null;
}

function describeAction(toolName: string, args: any): string {
  const a = args || {};
  if (toolName.toLowerCase().includes("send") || toolName.toLowerCase().includes("create")) {
    const parts: string[] = [];
    if (a.to) parts.push(`to ${a.to}`);
    if (a.subject) parts.push(`"${String(a.subject).slice(0, 60)}"`);
    if (a.channel) parts.push(`in ${a.channel}`);
    if (a.text) parts.push(`"${String(a.text).slice(0, 80)}"`);
    if (a.message) parts.push(`"${String(a.message).slice(0, 80)}"`);
    return parts.length ? parts.join(" ") : "…";
  }
  if (a.title) return String(a.title).slice(0, 80);
  if (a.name) return String(a.name).slice(0, 80);
  if (a.text) return `"${String(a.text).slice(0, 80)}"`;
  if (a.comment) return `"${String(a.comment).slice(0, 80)}"`;
  return "";
}

export const ConnectorToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args: rawArgs,
  result,
  status,
}) => {
  const meta = getMeta(toolName);
  const args = (rawArgs || {}) as any;
  const isRunning = status?.type === "running";
  const isComplete = status?.type === "complete";
  const needsConfirmation = status?.type === "requires-action";
  const icon = meta ? renderConnectorIcon(meta.id, 18) : null;
  const color = meta ? (COLORS[meta.id] || "#888") : "#888";
  const label = meta?.name || toolName;
  const action = describeAction(toolName, args);

  const [confirming, setConfirming] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const pollPending = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors/pending?threadId=default");
      const data = await res.json();
      const match = (data.pending || []).find(
        (p: any) => p.toolName === toolName && JSON.stringify(p.args) === JSON.stringify(args)
      );
      if (match) {
        setPendingId(match.confirmationId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [toolName, args]);

  useEffect(() => {
    if (!needsConfirmation) return;
    const interval = setInterval(async () => {
      const found = await pollPending();
      if (found) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [needsConfirmation, pollPending]);

  const handleConfirm = useCallback(async () => {
    if (!pendingId) return;
    setConfirming(true);
    try {
      await fetch("/api/connectors/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationId: pendingId, action: "confirm" }),
      });
    } catch {
      setConfirming(false);
    }
  }, [pendingId]);

  const handleCancel = useCallback(async () => {
    if (!pendingId) return;
    setConfirming(true);
    try {
      await fetch("/api/connectors/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationId: pendingId, action: "cancel" }),
      });
    } catch {
      setConfirming(false);
    }
  }, [pendingId]);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-2.5 text-sm">
      <div className="flex items-center gap-2">
        {icon && (
          <div className="size-6 flex items-center justify-center shrink-0 rounded-md bg-muted/40" style={{ color }}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium text-foreground/80" style={{ color: meta ? color : undefined }}>
            {label}
          </span>
          {action && (
            <span className="text-[11px] text-muted-foreground/60 ml-1.5 truncate">{action}</span>
          )}
        </div>
        {isRunning && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground/40 shrink-0" />}
        {isComplete && !needsConfirmation && <CheckIcon className="size-3.5 text-emerald-500 shrink-0" />}
      </div>

      {needsConfirmation && (
        <div className="flex items-center gap-1.5 mt-2 justify-end">
          <Button variant="ghost" size="sm" className="h-6 rounded-full px-2.5 text-[11px]" onClick={handleCancel} disabled={confirming}>
            <XIcon className="size-3 mr-1" /> Cancel
          </Button>
          <Button variant="outline" size="sm" className="h-6 rounded-full px-2.5 text-[11px]"
            style={{ borderColor: color === "currentColor" ? undefined : `${color}40`, color: color === "currentColor" ? undefined : color }}
            onClick={handleConfirm} disabled={confirming}>
            <CheckIcon className="size-3 mr-1" /> Confirm
          </Button>
        </div>
      )}
    </div>
  );
};

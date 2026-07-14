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

function extractContent(args: any): Record<string, string> {
  if (!args || typeof args !== "object") return {};
  const fields: Record<string, string> = {};
  if (args.to) fields["To"] = String(args.to);
  if (args.subject) fields["Subject"] = String(args.subject);
  if (args.channel) fields["Channel"] = String(args.channel);
  if (args.message) fields["Message"] = String(args.message).slice(0, 500);
  if (args.body) fields["Body"] = String(args.body).slice(0, 500);
  if (args.content) fields["Content"] = String(args.content).slice(0, 500);
  if (args.title) fields["Title"] = String(args.title);
  if (args.description) fields["Description"] = String(args.description).slice(0, 500);
  if (args.text) fields["Text"] = String(args.text).slice(0, 500);
  if (args.comment) fields["Comment"] = String(args.comment).slice(0, 500);
  if (args.name) fields["Name"] = String(args.name);
  return fields;
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
    } catch {}
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
    } catch {}
  }, [pendingId]);

  const contentFields = extractContent(args);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-3 text-sm">
      <div className="flex items-center gap-2.5 mb-2">
        {icon && (
          <div className="size-5 flex items-center justify-center shrink-0" style={{ color }}>
            {icon}
          </div>
        )}
        <span className="text-xs font-medium text-foreground/80" style={{ color: meta ? color : undefined }}>
          {meta?.name || toolName}
        </span>
        {isRunning && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground/40 shrink-0 ml-auto" />}
        {isComplete && <CheckIcon className="size-3.5 text-emerald-500 shrink-0 ml-auto" />}
      </div>

      {needsConfirmation && (
        <div className="space-y-2">
          <div className="rounded-lg bg-muted/30 p-2.5 space-y-1 font-mono text-[11px]">
            {Object.entries(contentFields).length > 0 ? (
              Object.entries(contentFields).map(([label, val]) => (
                <div key={label} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{label}:</span>
                  <span className="text-foreground/90 break-words">{val}</span>
                </div>
              ))
            ) : (
              <pre className="text-muted-foreground overflow-auto max-h-32">
                {JSON.stringify(args, null, 2)}
              </pre>
            )}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={handleCancel}
              disabled={confirming}
            >
              <XIcon className="size-3 mr-1" />
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              style={{
                borderColor: color === "currentColor" ? undefined : `${color}40`,
                color: color === "currentColor" ? undefined : color,
              }}
              onClick={handleConfirm}
              disabled={confirming}
            >
              <CheckIcon className="size-3 mr-1" />
              Confirm
            </Button>
          </div>
        </div>
      )}

      {isRunning && !needsConfirmation && (
        <p className="text-[11px] text-muted-foreground/60">Working...</p>
      )}

      {isComplete && result && (
        <div className="text-[11px] text-muted-foreground/70">
          {typeof result === "string"
            ? result.slice(0, 200)
            : JSON.stringify(result).slice(0, 200)}
        </div>
      )}
    </div>
  );
};

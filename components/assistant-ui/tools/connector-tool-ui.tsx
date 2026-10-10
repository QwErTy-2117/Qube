"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  getConnectorMetaForTool,
  inferConnectorMetasFromArgs,
  type ConnectorMeta,
} from "@/lib/connectors/connector-meta";
import { getCachedConnectors, type CachedConnector } from "@/lib/connectors/connectors-cache";
import { ConnectorBrandIcon } from "@/components/shared/connector-brand-icon";
import { composioLogoDarkClass } from "@/lib/connectors/composio-logo";
import { ToolRow } from "@/components/assistant-ui/tools/tool-row";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";
import { XIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Back-compat: previously a local prefix map. Now delegates to the shared
 * `connector-meta` resolver (strict "_" boundary, longest-first). Returns the
 * app-specific icon id (gmail → Gmail envelope, calendar → Calendar glyph)
 * so each card shows its own app's icon.
 */
export function getConnectorMeta(toolName: string): { id: string; name: string } | null {
  const meta = getConnectorMetaForTool(toolName);
  if (!meta) return null;
  return { id: meta.iconId, name: meta.name };
}

function describeAction(toolName: string, args: any): string {
  const a = args || {};
  const lower = String(toolName || "").toLowerCase();
  if (lower.includes("send") || lower.includes("create")) {
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

// Tilts cycle for stacked app tiles — same playful overlapping-tray look as
// the "Connect your apps" strip under the home-page composer.
const STACK_TILTS = [-8, 6, -5, 7, -6];

function ConnectorAppIcons({
  metas,
}: {
  metas: ConnectorMeta[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  // The generic "composio" entry has no app tile — a card with only that
  // resolves to no icons.
  const visible = metas.filter((m) => m.displayId !== "composio");
  if (visible.length === 0) return null;
  let cached: CachedConnector[] | null = null;
  try {
    cached = getCachedConnectors();
  } catch {}
  // Row-height tiles (size-4 = 16px = the text line height) so the header is
  // exactly as tall as every other ToolRow — no taller card.
  return (
    <span className="flex shrink-0 items-center">
      {visible.map((meta, i) => {
        // Per-app Composio logo first (logos.composio.dev artwork served via
        // the cached connector entry) — Gmail gets the envelope, Calendar the
        // calendar, Drive the triangle. Falls back to the shared static mark.
        const entry = cached?.find((c) => c.id.toLowerCase() === meta.displayId.toLowerCase()) ?? null;
        const composioLogo = entry?.toolkitLogos?.[meta.prefixes[0]];
        const isHovered = hovered === i;
        const push = hovered === null || isHovered ? 0 : i < hovered ? -4 : 4;
        const tilt = visible.length > 1 ? STACK_TILTS[i % STACK_TILTS.length] : 0;
        return (
          <span
            key={`${meta.iconId}-${i}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            title={meta.name}
            style={{
              transform: `rotate(${isHovered ? 0 : tilt}deg) translateX(${push}px)`,
            }}
            className={
              "relative flex size-4 items-center justify-center rounded-[5px] bg-background transition-transform duration-200 hover:scale-110 hover:z-10" +
              (i > 0 ? " -ml-1" : "")
            }
          >
            {composioLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={composioLogo} alt="" className={`size-3 object-contain${composioLogoDarkClass(meta.prefixes[0])}`} loading="lazy" />
            ) : (
              <ConnectorBrandIcon
                id={meta.iconId}
                icon={entry?.icon}
                brandColor={meta.brandColor}
                size={12}
                imgClassName="size-3"
                linkClassName="size-3"
              />
            )}
          </span>
        );
      })}
    </span>
  );
}

export const ConnectorToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args: rawArgs,
  result,
  status,
}) => {
  const directMeta = useMemo(() => getConnectorMetaForTool(toolName), [toolName]);
  const args = (rawArgs || {}) as any;
  const needsConfirmation = status?.type === "requires-action";

  // Meta-tools (`composio_search_tools`, `COMPOSIO_MULTI_EXECUTE_TOOL`) hide
  // the real app inside their payload — the tool name alone only resolves to
  // the generic "Apps" entry. Deep-scan the args for app identifiers so each
  // card still shows its own pre-made playful name + logo.
  const inferred = useMemo(() => {
    if (directMeta && directMeta.displayId !== "composio") return [];
    try {
      return inferConnectorMetasFromArgs(args).slice(0, 3);
    } catch {
      return [];
    }
  }, [directMeta, args]);
  const effective: ConnectorMeta | null =
    inferred.length === 1 ? inferred[0] : directMeta;
  // Icon tiles resolve per app (gmail → envelope, calendar → calendar glyph)
  // through the shared brand-icon sources — never the generic Google "G".
  const iconMetas: ConnectorMeta[] = useMemo(() => {
    const metas = inferred.length > 1 ? inferred : effective ? [effective] : [];
    const seen = new Set<string>();
    return metas.filter((m) => {
      const key = `${m.displayId}:${m.iconId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  }, [inferred, effective]);
  const color = effective?.brandColor || "#888";
  // Pre-made playful name wins (same voice as every other tool card).
  // Explicit model `label` arg first, then the inferred/direct app playful,
  // then the generic fallback. The raw tool id, the "· App" suffix, and
  // serious "Agent is using X" strings never show.
  const explicitLabel =
    typeof args.label === "string" && args.label.trim()
      ? args.label.trim().slice(0, 120)
      : "";
  const playful =
    explicitLabel ||
    (inferred.length === 1
      ? inferred[0].playful
      : friendlyToolLabel(toolName, args));
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

  void result;

  // Same shared row as every other tool call — icons + playful verb in the
  // header at identical height, confirm/cancel flat below the divider when
  // the run blocks on confirmation.
  return (
    <ToolRow
      verb={
        <span className="flex min-w-0 items-center gap-2">
          <ConnectorAppIcons metas={iconMetas} />
          <span className="truncate">{playful}</span>
        </span>
      }
      summary={action}
      status={status}
      open={needsConfirmation ? true : undefined}
      onOpenChange={() => {}}
    >
      {needsConfirmation ? (
        <div className="flex items-center gap-1.5 justify-end">
          <Button variant="ghost" size="sm" className="h-6 rounded-full px-2.5 text-[11px]" onClick={handleCancel} disabled={confirming}>
            <XIcon className="size-3 mr-1" /> Cancel
          </Button>
          <Button variant="outline" size="sm" className="h-6 rounded-full px-2.5 text-[11px]"
            style={{ borderColor: color === "currentColor" ? undefined : `${color}40`, color: color === "currentColor" ? undefined : color }}
            onClick={handleConfirm} disabled={confirming}>
            <CheckIcon className="size-3 mr-1" /> Confirm
          </Button>
        </div>
      ) : null}
    </ToolRow>
  );
};

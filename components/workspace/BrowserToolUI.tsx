"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { openBrowserWorkspace } from "@/lib/workspace/store";
import { ToolRow } from "@/components/assistant-ui/tools/tool-row";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";

function labelFor(toolName: string, args: Record<string, unknown>): string {
  // Act refines by action kind; everything else shares the single source
  // of truth (friendlyToolLabel) so browser rows use the exact same
  // non-serious names as every other tool call — and an explicit model
  // `label` arg always wins.
  if (toolName === "act") {
    const actions = (args as { actions?: Array<{ kind?: string }> }).actions;
    if (Array.isArray(actions) && actions.length > 0) {
      if (actions.length > 1) return "Browsing around";
      const kind = String(actions[0]?.kind || "");
      if (kind === "click") return "Clicking something";
      if (kind === "fill") return "Filling something in";
      if (kind === "type") return "Typing";
    }
    return "Browsing around";
  }
  return friendlyToolLabel(toolName, args);
}

function detailFor(toolName: string, args: Record<string, unknown>): string {
  const str = (v: unknown, max = 80): string =>
    typeof v === "string" ? v.slice(0, max) : "";
  if (toolName === "act") {
    const actions = (args as { actions?: Array<{ kind?: string; text?: string }> }).actions;
    if (Array.isArray(actions) && actions.length > 0) {
      if (actions.length > 1) return `${actions.length} steps`;
      const [first] = actions;
      if ((first.kind === "fill" || first.kind === "type") && first.text) {
        return `"${first.text.slice(0, 60)}"`;
      }
    }
    return "";
  }
  if (toolName === "run_action_plan") {
    const script = str((args as { script?: unknown }).script, 200);
    const firstLine = script.split("\n")[0] || "";
    if (/^navigate\s+/i.test(firstLine)) return str(firstLine.slice(9).trim());
    return `${script.split("\n").filter(Boolean).length} steps`;
  }
  if (toolName === "open_tab" || toolName === "navigate") {
    try {
      const url = str((args as { url?: unknown }).url);
      if (url) return new URL(url).hostname + new URL(url).pathname.slice(0, 40);
      return url.slice(0, 80);
    } catch {
      return str((args as { url?: unknown }).url);
    }
  }
  if (toolName === "click" || toolName === "move_mouse") {
    const x = (args as { x?: unknown }).x;
    const y = (args as { y?: unknown }).y;
    if (typeof x === "number" && typeof y === "number") return `${x}, ${y}`;
    return "";
  }
  if (toolName === "type") return str((args as { text?: unknown }).text, 60);
  if (toolName === "press_key") return str((args as { key?: unknown }).key, 24);
  if (toolName === "cdp") return str((args as { method?: unknown }).method, 60);
  if (toolName === "name_session") return str((args as { name?: unknown }).name, 60);
  const a = args || {};
  if (typeof a.url === "string") return a.url.slice(0, 80);
  if (typeof a.query === "string") return `"${a.query.slice(0, 60)}"`;
  if (typeof a.target === "string") return a.target.slice(0, 60);
  if (typeof a.text === "string") return a.text.slice(0, 60);
  if (typeof a.element === "string") return a.element.slice(0, 60);
  return "";
}

function errorFromResult(result: unknown): string {
  try {
    if (typeof result === "string") {
      const j = JSON.parse(result) as {
        content?: Array<{ text?: string }>;
        isError?: boolean;
        title?: string;
        url?: string;
      };
      if (j.isError && Array.isArray(j.content)) {
        return j.content.map((p) => p.text || "").join(" ").trim().slice(0, 160);
      }
      return (j.title || j.url || "").slice(0, 80);
    }
    if (result && typeof result === "object") {
      const r = result as { content?: Array<{ text?: string }>; isError?: boolean };
      if (r.isError && Array.isArray(r.content)) {
        return r.content.map((p) => p.text || "").join(" ").trim().slice(0, 160);
      }
    }
  } catch {}
  return "";
}

export const BrowserToolUI: ToolCallMessagePartComponent = ({ args, result, toolName, status }) => {
  const a = (args || {}) as Record<string, unknown>;
  // Same playful verb source as every other tool call.
  const verb = labelFor(toolName, a);
  const running = (status as { type?: string })?.type === "running";
  const detail = detailFor(toolName, a);
  const error = !running ? errorFromResult(result) : "";
  const summary = error || detail || (running ? "…" : "");
  const openPanel = () => {
    try {
      // The row header toggles expand (same as every other tool);
      // the expanded detail carries the live-page shortcut.
      openBrowserWorkspace();
    } catch {}
  };
  // Same expandable ToolRow card as every other tool call — verb +
  // muted inline summary + spinner/check + chevron, detail below the
  // divider. The live-page shortcut lives inside the expanded detail so
  // the header behavior matches all other tools exactly.
  const hasResult = result !== undefined && result !== null;
  const resultText = (() => {
    if (!hasResult) return null;
    try {
      const text =
        typeof result === "string"
          ? result.slice(0, 2000)
          : JSON.stringify(result, null, 2).slice(0, 2000);
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  })();

  if (!detail && !error && !resultText) {
    return <ToolRow verb={verb} summary={summary} status={status} result={result} />;
  }

  return (
    <ToolRow verb={verb} summary={summary} status={status} result={result} defaultOpen={false}>
      <div className="space-y-2">
        {detail ? (
          <div className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {detail}
          </div>
        ) : null}
        {error && error !== detail ? (
          <div className="text-xs break-words whitespace-pre-wrap text-red-500/90">{error}</div>
        ) : null}
        {resultText ? (
          <div className="max-h-48 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {resultText}
          </div>
        ) : null}
        <button
          type="button"
          onClick={openPanel}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Show live page
        </button>
      </div>
    </ToolRow>
  );
};

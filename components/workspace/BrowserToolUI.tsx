"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  GlobeIcon,
  SearchIcon,
  MousePointerClickIcon,
  KeyboardIcon,
  ArrowLeftIcon,
  FileTextIcon,
  CameraIcon,
  MouseIcon,
  HourglassIcon,
  CheckIcon,
  LayoutGridIcon,
} from "lucide-react";

const ICONS: Record<string, typeof GlobeIcon> = {
  open_tab: GlobeIcon,
  navigate: GlobeIcon,
  tabs: LayoutGridIcon,
  user_tabs: LayoutGridIcon,
  page_info: FileTextIcon,
  snapshot: FileTextIcon,
  cdp: FileTextIcon,
  click: MousePointerClickIcon,
  act: MousePointerClickIcon,
  type: KeyboardIcon,
  press_key: KeyboardIcon,
  move_mouse: MouseIcon,
  run_action_plan: MousePointerClickIcon,
  wait_load: HourglassIcon,
  claim_tab: CheckIcon,
  finalize_tabs: CheckIcon,
  ping: GlobeIcon,
  info: GlobeIcon,
  name_session: FileTextIcon,
  turn_ended: CheckIcon,
  // Legacy browser_* names (kept for old sessions)
  browser_navigate: GlobeIcon,
  browser_navigate_back: ArrowLeftIcon,
  browser_navigate_forward: ArrowLeftIcon,
  browser_search: SearchIcon,
  browser_click: MousePointerClickIcon,
  browser_hover: MousePointerClickIcon,
  browser_drag: MousePointerClickIcon,
  browser_type: KeyboardIcon,
  browser_fill: KeyboardIcon,
  browser_find: SearchIcon,
  browser_fill_form: KeyboardIcon,
  browser_press_key: KeyboardIcon,
  browser_select_option: KeyboardIcon,
  browser_file_upload: KeyboardIcon,
  browser_back: ArrowLeftIcon,
  browser_read: FileTextIcon,
  browser_snapshot: FileTextIcon,
  browser_screenshot: CameraIcon,
  browser_console_messages: FileTextIcon,
  browser_network_requests: FileTextIcon,
  browser_evaluate: FileTextIcon,
  browser_wait_for: HourglassIcon,
  browser_tabs: LayoutGridIcon,
  browser_close: GlobeIcon,
  browser_handle_dialog: GlobeIcon,
};

function labelFor(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "act") {
    const actions = (args as { actions?: Array<{ kind?: string }> }).actions;
    if (Array.isArray(actions) && actions.length > 0) {
      if (actions.length > 1) return `${actions.length} actions`;
      const kind = String(actions[0]?.kind || "");
      if (kind === "click") return "Clicking";
      if (kind === "fill") return "Filling";
      if (kind === "type") return "Typing";
    }
    return "Acting";
  }
  const LABELS: Record<string, string> = {
    open_tab: "Opening tab",
    navigate: "Navigating",
    tabs: "Listing tabs",
    user_tabs: "Listing tabs",
    page_info: "Reading page",
    snapshot: "Reading page",
    cdp: "Running script",
    click: "Clicking",
    type: "Typing",
    press_key: "Pressing key",
    move_mouse: "Moving mouse",
    run_action_plan: "Running actions",
    wait_load: "Waiting for page",
    claim_tab: "Claiming tab",
    finalize_tabs: "Finalizing tabs",
    ping: "Checking browser",
    info: "Browser info",
    name_session: "Naming session",
    turn_ended: "Turn ended",
    // Legacy browser_* names (kept for old sessions)
    browser_navigate: "Navigating",
    browser_navigate_back: "Going back",
    browser_navigate_forward: "Going forward",
    browser_search: "Searching",
    browser_click: "Clicking",
    browser_hover: "Hovering",
    browser_drag: "Dragging",
    browser_type: "Typing",
    browser_fill: "Filling",
    browser_find: "Finding",
    browser_fill_form: "Filling form",
    browser_press_key: "Pressing key",
    browser_select_option: "Selecting option",
    browser_file_upload: "Uploading file",
    browser_handle_dialog: "Handling dialog",
    browser_back: "Going back",
    browser_read: "Reading page",
    browser_snapshot: "Reading page",
    browser_screenshot: "Capturing page",
    browser_console_messages: "Reading console",
    browser_network_requests: "Reading network",
    browser_evaluate: "Running script",
    browser_wait_for: "Waiting",
    browser_tabs: "Managing tabs",
    browser_close: "Closing browser",
  };
  return LABELS[toolName] || toolName;
}

function detailFor(toolName: string, args: Record<string, unknown>): string {
  const str = (v: unknown, max = 80): string =>
    typeof v === "string" ? v.slice(0, max) : "";
  if (toolName === "act") {
    const actions = (args as { actions?: Array<{ kind?: string; ref?: string; text?: string }> }).actions;
    if (Array.isArray(actions) && actions.length > 0) {
      if (actions.length > 1) {
        return actions
          .slice(0, 3)
          .map((a) => `${a.kind || "act"} ${a.ref || ""}`.trim())
          .join(", ");
      }
      const [first] = actions;
      if ((first.kind === "fill" || first.kind === "type") && first.text) {
        return `"${first.text.slice(0, 60)}"`;
      }
      return str(first.ref, 24);
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
  const Icon = ICONS[toolName] || GlobeIcon;
  const a = (args || {}) as Record<string, unknown>;
  const label = labelFor(toolName, a);
  const running = (status as { type?: string })?.type === "running";
  const detail = detailFor(toolName, a);
  const error = !running ? errorFromResult(result) : "";
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2 text-sm">
      <span className={`flex size-6 items-center justify-center rounded-full ${running ? "bg-amber-400/15" : error ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
        <Icon className={`size-3.5 ${running ? "animate-pulse text-amber-500" : error ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`} />
      </span>
      <span className="font-medium text-foreground/90">{label}</span>
      {detail ? <span className="truncate font-mono text-xs text-muted-foreground">{detail}</span> : null}
      {error ? <span className="truncate text-xs text-red-500/90">{error}</span> : null}
      {running ? <span className="ml-auto shrink-0 text-[11px] text-amber-600 dark:text-amber-400">working…</span> : null}
    </div>
  );
};

"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { GlobeIcon, SearchIcon, MousePointerClickIcon, KeyboardIcon, ArrowLeftIcon, FileTextIcon } from "lucide-react";

const ICONS: Record<string, typeof GlobeIcon> = {
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
  browser_screenshot: FileTextIcon,
  browser_console_messages: FileTextIcon,
  browser_network_requests: FileTextIcon,
  browser_evaluate: FileTextIcon,
  browser_wait_for: GlobeIcon,
  browser_tabs: GlobeIcon,
  browser_close: GlobeIcon,
  browser_handle_dialog: GlobeIcon,
};

const LABELS: Record<string, string> = {
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

export const BrowserToolUI: ToolCallMessagePartComponent = ({ args, result, toolName, status }) => {
  const Icon = ICONS[toolName] || GlobeIcon;
  const label = LABELS[toolName] || toolName;
  const running = (status as { type?: string })?.type === "running";
  let detail = "";
  try {
    const a = (args || {}) as Record<string, unknown>;
    if (typeof a.url === "string") detail = a.url.slice(0, 80);
    else if (typeof a.query === "string") detail = `"${a.query.slice(0, 60)}"`;
    else if (typeof a.target === "string") detail = a.target.slice(0, 60);
    else if (typeof a.text === "string") detail = a.text.slice(0, 60);
    else if (typeof a.element === "string") detail = a.element.slice(0, 60);
    if (!detail && typeof result === "string") {
      const j = JSON.parse(result) as { title?: string; url?: string; query?: string };
      detail = (j.title || j.url || j.query || "").slice(0, 80);
    }
  } catch {}
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2 text-sm">
      <span className={`flex size-6 items-center justify-center rounded-full ${running ? "bg-amber-400/15" : "bg-emerald-500/10"}`}>
        <Icon className={`size-3.5 ${running ? "animate-pulse text-amber-500" : "text-emerald-600 dark:text-emerald-400"}`} />
      </span>
      <span className="font-medium text-foreground/90">{label}</span>
      {detail ? <span className="truncate font-mono text-xs text-muted-foreground">{detail}</span> : null}
      {running ? <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">working…</span> : null}
    </div>
  );
};

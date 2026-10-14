import type { ActionDescriptor } from "./types";
import { BROWSER_MCP_TOOL_PREFIX } from "@/lib/pi/browser-mcp";

const OBSERVE_SUFFIX = new Set(["snapshot", "screenshot", "tabs", "page_info", "ping", "wait_load", "move_mouse", "user_tabs"]);
const NAVIGATE_SUFFIX = new Set(["navigate", "open_tab"]);

function base(tool: string, domain: ActionDescriptor["domain"], kind: ActionDescriptor["kind"], mutating: boolean): ActionDescriptor {
  return { tool, domain, kind, mutating, refs: [], points: [], typed: [], keys: [], urls: [], targetText: "", summary: tool };
}

export function isKernelTool(tool: string): boolean {
  return describeAction(tool, {}).domain !== "other";
}

function summarize(tool: string, parts: string[]): string {
  const s = parts.filter(Boolean).join(" ").slice(0, 160);
  return s ? `${tool} ${s}` : tool;
}

export function describeAction(tool: string, args: Record<string, unknown>): ActionDescriptor {
  const a = (args ?? {}) as Record<string, any>;
  switch (tool) {
    case "browser_screenshot":
    case "computer_observe":
      return { ...base(tool, "browser", "observe", false), summary: `${tool} observe` };
    case "browser_snapshot":
      return { ...base(tool, "browser", "observe", false), summary: `${tool} observe` };
    case "browser_navigate": {
      const url = String(a.url ?? "");
      return { ...base(tool, "browser", "navigate", false), urls: url ? [url] : [], targetText: url, summary: summarize(tool, [url]) };
    }
    case "open_path": {
      const p = String(a.path ?? "");
      const isUrl = /^https?:\/\//i.test(p);
      return { ...base(tool, isUrl ? "browser" : "file", isUrl ? "navigate" : "interact", false), urls: isUrl ? [p] : [], targetText: p, summary: summarize(tool, [p]) };
    }
    case "browser_act": {
      const d = { ...base(tool, "browser", "interact", true) };
      const acts = Array.isArray(a.actions) ? a.actions : [];
      for (const act of acts) {
        if (act && typeof act === "object") {
          const ref = String((act as any).ref ?? "");
          if (/^e\d+$/.test(ref)) d.refs.push(ref);
          const text = String((act as any).text ?? "");
          if (text) d.typed.push(text.slice(0, 200));
        }
      }
      d.summary = summarize(tool, d.refs.concat(d.typed.map((t) => `"${t.slice(0, 40)}"`)));
      return d;
    }
    case "browser_pixel_act":
    case "computer_act": {
      const d = { ...base(tool, "browser", "interact", true) };
      const acts = Array.isArray(a.actions) ? a.actions : [];
      let sawText = false;
      for (const act of acts) {
        if (!act || typeof act !== "object") continue;
        const kind = String((act as any).kind ?? "").toLowerCase();
        const x = Number((act as any).x);
        const y = Number((act as any).y);
        if (Number.isFinite(x) && Number.isFinite(y) && (kind === "click" || kind === "down" || kind === "up" || kind === "move")) {
          d.points.push({ x: Math.round(x), y: Math.round(y) });
        }
        const text = String((act as any).text ?? "");
        if (text && (kind === "type" || kind === "")) { d.typed.push(text.slice(0, 200)); sawText = true; }
        const key = String((act as any).key ?? "");
        if (key) d.keys.push(key.slice(0, 40));
      }
      if (sawText && d.points.length === 0 && d.keys.length === 0) d.kind = "input";
      d.summary = summarize(tool, [`${acts.length} step(s)`]);
      return d;
    }
    case "request_takeover":
      return { ...base(tool, "browser", "meta", false), targetText: String(a.reason ?? "").slice(0, 160), summary: summarize(tool, ["takeover"]) };
    case "dev_server":
      return { ...base(tool, "terminal", "exec", true), targetText: String(a.command ?? ""), summary: summarize(tool, [String(a.command ?? "").slice(0, 80)]) };
    case "dev_server_log":
      return { ...base(tool, "terminal", "observe", false), targetText: String(a.command ?? ""), summary: summarize(tool, ["log"]) };
    case "run_command":
      return { ...base(tool, "terminal", "exec", true), targetText: String(a.command ?? "").slice(0, 300), summary: summarize(tool, [String(a.command ?? "").slice(0, 80)]) };
    case "read_file":
    case "list_directory":
      return { ...base(tool, "file", "observe", false), targetText: String(a.path ?? ""), summary: summarize(tool, [String(a.path ?? "")]) };
    case "write_file":
    case "edit_file":
    case "delete_file":
      return { ...base(tool, "file", "interact", true), targetText: String(a.path ?? (a as any).filepath ?? ""), summary: summarize(tool, [String(a.path ?? (a as any).filepath ?? "")]) };
    default: break;
  }
  if (tool.startsWith(BROWSER_MCP_TOOL_PREFIX)) {
    const suffix = tool.slice(BROWSER_MCP_TOOL_PREFIX.length);
    const d = base(tool, "browser", "interact", true);
    if (OBSERVE_SUFFIX.has(suffix)) { d.kind = "observe"; d.mutating = false; }
    else if (NAVIGATE_SUFFIX.has(suffix)) {
      d.kind = "navigate"; d.mutating = false;
      const url = String(a.url ?? "");
      if (url) { d.urls = [url]; d.targetText = url; }
    } else if (suffix === "click" || suffix === "move_mouse") {
      const x = Number(a.x); const y = Number(a.y);
      if (Number.isFinite(x) && Number.isFinite(y)) d.points.push({ x: Math.round(x), y: Math.round(y) });
    } else if (suffix === "type") {
      const text = String(a.text ?? "");
      if (text) d.typed.push(text.slice(0, 200));
      d.kind = "input";
    } else if (suffix === "press_key") {
      const key = String(a.key ?? "");
      if (key) d.keys.push(key.slice(0, 40));
    } else if (suffix === "act") {
      const acts = Array.isArray(a.actions) ? a.actions : [];
      for (const act of acts) {
        const ref = String((act as any)?.ref ?? "");
        if (/^e\d+$/.test(ref)) d.refs.push(ref);
        const text = String((act as any)?.text ?? "");
        if (text) d.typed.push(text.slice(0, 200));
      }
    } else if (suffix === "dismiss_dialogs" || suffix === "switch_tab") {
      d.kind = "interact"; d.mutating = false;
    } else if (suffix === "close_tab") {
      d.kind = "interact"; d.mutating = true;
    } else if (suffix === "download") {
      d.kind = "interact"; d.mutating = false;
      const url = String(a.url ?? "");
      if (url) { d.urls = [url]; d.targetText = url; }
    } else if (suffix === "upload") {
      d.kind = "input"; d.mutating = true;
      const ref = String(a.ref ?? "");
      if (/^e\d+$/.test(ref)) d.refs.push(ref);
      const fp = String(a.path ?? "");
      if (fp) d.targetText = fp;
    }
    d.summary = summarize(tool, d.refs.concat(d.urls).concat(d.typed.map((t) => `"${t.slice(0, 40)}"`)));
    return d;
  }
  if (tool.startsWith("computer_")) {
    if (tool === "computer_clipboard_read") {
      const d = base(tool, "desktop", "observe", false);
      d.summary = summarize(tool, ["clipboard"]);
      return d;
    }
    const d = base(tool, "desktop", "interact", true);
    d.summary = summarize(tool, [String(a.app ?? a.text ?? a.key ?? "").slice(0, 60)]);
    return d;
  }
  return base(tool, "other", "meta", false);
}

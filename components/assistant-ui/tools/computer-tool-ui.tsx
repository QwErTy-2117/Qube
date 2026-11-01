"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

function parseResult(result: unknown): any | null {
  try {
    if (typeof result === "string") {
      const t = result.trim();
      if (!t) return null;
      try {
        return JSON.parse(t);
      } catch {
        return { text: t.slice(0, 4000) };
      }
    }
    if (result && typeof result === "object") return result as any;
  } catch {}
  return null;
}

function summaryFor(toolName: string, args: Record<string, unknown>): string {
  const str = (v: unknown, max = 60): string =>
    typeof v === "string" ? v.slice(0, max) : "";
  const app = str((args as any)?.app, 40);
  switch (toolName) {
    case "computer_list_apps":
      return "";
    case "computer_get_app_state":
      return app;
    case "computer_click": {
      const idx = str((args as any)?.element_index, 12);
      if (app && idx) return `${app} · ${idx}`;
      return app || idx;
    }
    case "computer_secondary_action":
      return app;
    case "computer_scroll":
      return app;
    case "computer_drag":
      return app;
    case "computer_type_text": {
      const text = str((args as any)?.text, 60);
      return app && text ? `${app} · "${text}"` : text || app;
    }
    case "computer_press_key": {
      const key = str((args as any)?.key, 24);
      return app && key ? `${app} · ${key}` : key || app;
    }
    case "computer_set_value": {
      const value = str((args as any)?.value, 60);
      return app && value ? `${app} · "${value}"` : app;
    }
    case "computer_launch_app":
    case "computer_activate_window":
      return app;
    case "computer_doctor":
    case "computer_capabilities":
      return "";
    case "computer_run_sequence": {
      const calls = (args as any)?.calls;
      const n = Array.isArray(calls) ? calls.length : 0;
      const firstApp = Array.isArray(calls)
        ? String(calls.find((c: any) => c?.args?.app)?.args?.app || "").slice(0, 40)
        : "";
      const kinds = Array.isArray(calls)
        ? calls.map((c: any) => String(c?.tool || "")).filter(Boolean).slice(0, 3).join(" → ").slice(0, 60)
        : "";
      if (firstApp && kinds) return `${firstApp} · ${kinds}${n > 3 ? ` +${n - 3}` : ""}`;
      return firstApp || (n ? `${n} steps` : "");
    }
    default:
      return app;
  }
}

function detailText(toolName: string, data: any): string | null {
  if (!data || typeof data !== "object") return null;
  // Error / install-hint path — show the message plainly.
  if ((data as any).error && (data as any).message) {
    return String((data as any).message).slice(0, 2000);
  }
  if (typeof (data as any).text === "string" && !(data as any).apps && !(data as any).tree) {
    return String((data as any).text).slice(0, 2000);
  }
  try {
    if (toolName === "computer_list_apps") {
      const apps = (data as any).apps ?? (data as any).applications ?? (data as any).result;
      if (Array.isArray(apps)) {
        return apps
          .slice(0, 30)
          .map((a: any) =>
            typeof a === "string" ? a : (a?.name ?? a?.app ?? a?.bundle_id ?? JSON.stringify(a)).toString(),
          )
          .join("\n")
          .slice(0, 2000);
      }
    }
    if (toolName === "computer_get_app_state") {
      const tree =
        (data as any).tree ?? (data as any).accessibility_tree ?? (data as any).content;
      if (typeof tree === "string" && tree.trim()) return tree.slice(0, 4000);
      if (Array.isArray((data as any).content)) {
        const text = (data as any).content
          .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
          .join("\n")
          .trim();
        if (text) return text.slice(0, 4000);
      }
    }
    return JSON.stringify(data, null, 2).slice(0, 2000);
  } catch {
    return null;
  }
}

export const ComputerToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  const a = ((args || {}) as Record<string, unknown>) ?? {};
  const running = (status as { type?: string })?.type === "running";
  const verb = friendlyToolLabel(toolName, args);
  const summary = summaryFor(toolName, a) || (running ? "…" : "");
  const data = parseResult(result);
  const hasResult = result !== undefined && result !== null;
  const detail = hasResult ? detailText(toolName, data) : null;

  if (!detail) {
    return <ToolRow verb={verb} summary={summary} status={status} result={result} />;
  }

  return (
    <ToolRow verb={verb} summary={summary} defaultOpen={false} status={status} result={result}>
      <div className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
        {detail}
      </div>
    </ToolRow>
  );
};

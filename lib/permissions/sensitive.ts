/**
 * Sentinel-style sensitive-action classifier (Muse reference).
 *
 * Muse runs a separate Sentinel that is the sole permission authority:
 * the agent proposes, Sentinel allows / denies / asks, and sensitive
 * actions (send email, purchase, delete, share private data) always pause
 * for an explicit user decision with a visible purpose + audit trail.
 *
 * Qube mirrors that here:
 * - read-only lookups never pause (clean requests auto-allow)
 * - destructive / external side effects pause via the permission widget
 * - the chat loop blocks until the user allows once / always / denies
 *
 * Used by permission-middleware (foreground chat) and the Pi harness
 * (connector tool wrapping). Headless runs can't prompt, so the heartbeat
 * monitor drafts instead of sending — but a USER-CREATED scheduled task
 * may perform the sends/creates/deletes its instructions explicitly
 * request (creating the task WAS the approval). See
 * shouldGateConnectorTool and task-runner.
 */

import { isDestructiveCommand } from "@/lib/middleware/workspace";

export type SensitiveKind =
  | "send_email"
  | "send_message"
  | "create_external"
  | "delete_file"
  | "delete_external"
  | "modify_external"
  | "destructive_command"
  | "outside_workspace"
  | "purchase"
  | "share_private";

export interface SensitiveVerdict {
  sensitive: boolean;
  kind?: SensitiveKind;
  /** User-visible purpose (Muse Sentinel-style: what + where + why it needs you). */
  purpose: string;
}

const CONNECTOR_WRITE_RE =
  /(send|create|post|publish|share|invite|schedule|book|order|purchase|pay|transfer|upload|delete|remove|destroy|trash|cancel|update|edit|modify|move|archive|comment|reply|post_message)/i;

const CONNECTOR_DELETE_RE = /(delete|remove|destroy|trash|cancel|revoke)/i;
const CONNECTOR_SEND_RE = /(send|post|publish|share|invite|reply|comment|schedule|book)/i;

const EMAIL_TOOLS_RE = /(gmail|email|mail)/i;
const CHAT_TOOLS_RE = /(slack|discord|teams|message|chat)/i;

/** Connector tool names are dynamic (Composio). Classify by name pattern. */
export function isSensitiveConnectorTool(toolName: string): boolean {
  if (!toolName) return false;
  const lower = toolName.toLowerCase();
  // Never gate the connection helper itself.
  if (lower === "connect_service" || lower === "composio_search_tools") return false;
  return CONNECTOR_WRITE_RE.test(toolName);
}

export function connectorSensitiveKind(toolName: string): SensitiveKind {
  const lower = toolName.toLowerCase();
  if (/(purchase|pay|order|checkout)/i.test(lower)) return "purchase";
  if (CONNECTOR_DELETE_RE.test(lower)) return "delete_external";
  if (CONNECTOR_SEND_RE.test(lower)) {
    if (EMAIL_TOOLS_RE.test(lower)) return "send_email";
    if (CHAT_TOOLS_RE.test(lower)) return "send_message";
    return "send_message";
  }
  if (/(share)/i.test(lower)) return "share_private";
  return "create_external";
}

/** Human purpose line for the permission widget (Muse audit-trail style). */
export function describeConnectorAction(toolName: string, args: Record<string, unknown>): string {
  const a = (args || {}) as Record<string, any>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = a[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
    }
    return "";
  };
  const kind = connectorSensitiveKind(toolName);
  const to = pick("to", "recipient", "email", "channel", "channel_id", "user", "assignee");
  const subject = pick("subject", "title", "name", "summary");
  const text = pick("text", "message", "body", "content", "comment", "description");

  switch (kind) {
    case "send_email":
      return `Send email${to ? ` to ${to}` : ""}${subject ? ` — "${subject}"` : ""}${text ? ` — "${text.slice(0, 80)}"` : ""}`.trim() || "Send an email on your behalf";
    case "send_message":
      return `Post a message${to ? ` in ${to}` : ""}${text ? ` — "${text.slice(0, 80)}"` : ""}`.trim() || "Post a message on your behalf";
    case "delete_external":
      return `Delete in ${toolName}${subject ? ` — "${subject}"` : ""}`.trim() || `Delete via ${toolName}`;
    case "purchase":
      return `Make a purchase via ${toolName}${subject ? ` — "${subject}"` : ""}`.trim();
    case "share_private":
      return `Share data via ${toolName}${to ? ` with ${to}` : ""}`.trim();
    default: {
      const verb = /delete/i.test(toolName) ? "Delete" : /update|edit|modify/i.test(toolName) ? "Change" : "Create";
      return `${verb} via ${toolName}${subject ? ` — "${subject}"` : to ? ` — ${to}` : ""}`.trim();
    }
  }
}

export function classifyLocalTool(
  toolName: string,
  args: Record<string, unknown>,
): SensitiveVerdict {
  // Delete is always sensitive — even inside the workspace (Muse: destructive
  // actions pause). Reads/writes inside the workspace otherwise auto-allow.
  if (toolName === "delete_file") {
    const p = (args.path as string) || (args.filepath as string) || "this file";
    return { sensitive: true, kind: "delete_file", purpose: `Delete file "${String(p).slice(0, 160)}" — this cannot be undone` };
  }
  if (toolName === "run_command") {
    const cmd = String((args.command as string) || "");
    // Destructive shell always pauses; other commands are covered by
    // workspace rules (outside-workspace check happens in middleware).
    if (cmd && isDestructiveCommand(cmd)) {
      return { sensitive: true, kind: "destructive_command", purpose: `Run destructive command "$ ${cmd.slice(0, 160)}"` };
    }
    return { sensitive: false, purpose: "" };
  }
  if (isSensitiveConnectorTool(toolName)) {
    return {
      sensitive: true,
      kind: connectorSensitiveKind(toolName),
      purpose: describeConnectorAction(toolName, args),
    };
  }
  return { sensitive: false, purpose: "" };
}

/** Read-only connector verbs that never pause (Sentinel clean-request path). */
export function isReadOnlyConnectorTool(toolName: string): boolean {
  if (!toolName) return true;
  if (isSensitiveConnectorTool(toolName)) return false;
  return /(list|search|get|read|fetch|find|query|describe|show|view|lookup)/i.test(toolName) || true;
}

/**
 * Headless gating rule for background runs (which cannot show the approval
 * widget). The autonomous heartbeat monitor is NEVER allowed external side
 * effects — its sensitive tools become draft-only stubs. A user-created
 * SCHEDULED task, in contrast, carries explicit approval in its own
 * instructions ("email me the report every morning"), so its connector
 * tools run for real. Read-only tools are never gated for either.
 */
export function shouldGateConnectorTool(
  taskType: string,
  toolName: string,
): boolean {
  if (taskType !== "heartbeat") return false;
  return isSensitiveConnectorTool(toolName);
}

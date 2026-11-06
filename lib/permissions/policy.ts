/**
 * Global action policy (Settings → Advanced → Heartbeat and Task).
 *
 * These switches are hard limits, not hints: when a category is off the
 * matching tool is denied before any approval UI is created. The self-review
 * flow can only approve actions that the policy already allows.
 */

import { settingsStore } from "@/lib/settings-store";
import {
  classifyLocalTool,
  type SensitiveKind,
} from "@/lib/permissions/sensitive";

export type PermissionCategory = "tool" | "connector";

export type PermissionSettings = {
  /** Built-in file / shell / browser / computer tools. */
  allowTools: boolean;
  /** Connected-service tools (Gmail, Slack, GitHub, …). */
  allowConnectors: boolean;
  /** Deletes, destructive shell commands, and destructive connector actions. */
  allowDestructive: boolean;
  /** Skip the self-review call and run allowed sensitive actions directly. */
  autoApprove: boolean;
};

export type PolicyDecision =
  | { allowed: true; destructive: boolean }
  | { allowed: false; destructive: boolean; reason: string };

const DESTRUCTIVE_KINDS = new Set<SensitiveKind>([
  "delete_file",
  "destructive_command",
  "delete_external",
  "purchase",
  "merge_pull_request",
  "close_issue",
]);

export function getPermissionSettings(): PermissionSettings {
  let settings: ReturnType<typeof settingsStore.getAll> = {};
  try {
    settings = settingsStore.getAll();
  } catch {
    // A broken settings file must never silently open the gates.
  }
  return {
    allowTools: settings.allowTools !== false,
    allowConnectors: settings.allowConnectors !== false,
    allowDestructive: settings.allowDestructiveActions === true,
    autoApprove: settings.autoApproveActions === true,
  };
}

/** True when the classifier marks this as an irreversible/destructive action. */
export function isDestructiveAction(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  try {
    const verdict = classifyLocalTool(toolName, args || {});
    return !!verdict.kind && DESTRUCTIVE_KINDS.has(verdict.kind);
  } catch {
    // Unknown actions are not destructive by themselves; sensitive gating
    // still runs through the reviewer.
    return false;
  }
}

/**
 * Enforce the category switches. Callers must stop on `allowed: false`
 * and return `reason` to the agent — never fall through to an approval card.
 */
export function checkActionPolicy(
  toolName: string,
  args: Record<string, unknown>,
  category: PermissionCategory = "tool",
): PolicyDecision {
  const settings = getPermissionSettings();
  const destructive = isDestructiveAction(toolName, args);

  if (category === "connector" && !settings.allowConnectors) {
    return {
      allowed: false,
      destructive,
      reason:
        "Blocked: connectors are turned off in Settings → Advanced → Heartbeat and Task.",
    };
  }

  if (category === "tool" && !settings.allowTools) {
    return {
      allowed: false,
      destructive,
      reason:
        "Blocked: tools are turned off in Settings → Advanced → Heartbeat and Task.",
    };
  }

  if (destructive && !settings.allowDestructive) {
    return {
      allowed: false,
      destructive,
      reason:
        "Blocked: destructive actions are turned off in Settings → Advanced → Heartbeat and Task.",
    };
  }

  return { allowed: true, destructive };
}

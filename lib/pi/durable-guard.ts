import { defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { approvalMemoKey } from "@/lib/pi/durable-registry";
import { isSensitiveConnectorTool } from "@/lib/permissions/sensitive";
import { isDestructiveCommand } from "@/lib/middleware/workspace";
import { Approvals } from "@/lib/pi/durable-docs";

const COMPUTER_READONLY = new Set(["computer_list_apps", "computer_get_app_state", "computer_clipboard_read"]);

/**
 * Mirror of the foreground permission policy for the durable path:
 * read-only lookups never pause; destructive / external side effects
 * require an explicit decision. Single source of truth stays in
 * lib/permissions/sensitive.ts (connector classifier).
 */
export function isSensitiveDurableTool(toolName: string, args?: unknown): boolean {
  if (toolName === "delete_file") return true;
  if (toolName.startsWith("computer_") && !COMPUTER_READONLY.has(toolName)) return true;
  if (toolName === "run_command") {
    const command = (args as { command?: unknown } | null)?.command;
    return typeof command === "string" && isDestructiveCommand(command);
  }
  try {
    if (isSensitiveConnectorTool(toolName)) return true;
  } catch {
    // Classifier must never break tool execution; fail open to allow.
  }
  return false;
}

export function argsHash(args: unknown): string {
  try {
    return JSON.stringify(args ?? {}).slice(0, 200);
  } catch {
    return String(args).slice(0, 200);
  }
}

export type GuardMemoApi = {
  memo<T>(name: string, context: unknown): Promise<T | undefined>;
  memo<T>(name: string, candidate: T, context: unknown): Promise<T>;
  /** HookApi is a DocumentReader: read the session approvals ledger. */
  snapshot?<T>(token: unknown, context: unknown): Promise<T | undefined>;
};

/**
 * beforeTool handler: sensitive tools need a memoized approval. First
 * write wins, so a restart reuses the stored decision instead of
 * re-asking. Without an approval UI wired yet, the first decision
 * defaults to deny with guidance to ask the user; a future approval
 * surface memos `true` for the same key to allow.
 */
export function createGuardBeforeTool() {
  return async (
    call: { name: string; arguments?: unknown },
    api: GuardMemoApi,
    context: unknown,
  ): Promise<{ block?: string } | undefined> => {
    if (!isSensitiveDurableTool(call.name, call.arguments)) return undefined;
    const key = approvalMemoKey(call.name, argsHash(call.arguments));

    // 1) Durable session ledger written by the app/UI on user decision.
    if (api.snapshot) {
      try {
        const snap = await api.snapshot<{ allowed?: Record<string, number>; denied?: Record<string, number> }>(
          Approvals,
          context,
        );
        if (snap?.allowed?.[key]) return undefined;
        if (snap?.denied?.[key]) {
          return { block: `Not approved: ${call.name} was denied. Ask the user before retrying.` };
        }
      } catch {
        // Ledger read is best-effort; fall through to the task memo.
      }
    }

    // 2) Task memo (a prior decision within this tool task).
    const prior = await api.memo<boolean>(key, context).catch(() => undefined);
    if (prior === true) return undefined;
    if (prior === false) return { block: `Not approved: ${call.name} was denied earlier. Ask the user before retrying.` };
    const decision = await api.memo<boolean>(key, false, context).catch(() => false as boolean);
    if (decision === true) return undefined;
    return {
      block:
        `Approval required before ${call.name}: this action reaches outside the workspace or deletes data. ` +
        `Ask the user for explicit approval first (key ${key}; an approval for that key allows the call).`,
    };
  };
}

export function buildGuardExtension() {
  return defineExtension({
    name: "guard",
    hooks: [hook(ToolTask, { beforeTool: createGuardBeforeTool() as never })],
  });
}

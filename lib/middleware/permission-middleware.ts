import { resolve, relative } from "node:path";
import { getWorkspacePath, isDestructiveCommand } from "./workspace";
import { allowedDirsStore, toAbsoluteDir, type DirAccess } from "@/lib/permissions/allowed-dirs";
import type { TaskPermissions } from "@/lib/scheduler/types";

export type PermissionRequest = {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  threadId: string;
  approved: boolean | null;
  createdAt: number;
};

type PermissionResolver = {
  resolve: (value: { approved: boolean }) => void;
  reject: (error: Error) => void;
};

const pendingPermissions = new Map<string, PermissionResolver>();
const permissionStore = new Map<string, PermissionRequest>();
let requestCounter = 0;

export function generateRequestId(): string {
  return `perm_${Date.now()}_${++requestCounter}`;
}

const PERM_STALE_MS = 30 * 60 * 1000;

function purgeStalePermissions() {
  const now = Date.now();
  for (const [id, req] of permissionStore) {
    if (req.approved !== null || now - req.createdAt > PERM_STALE_MS) {
      permissionStore.delete(id);
      pendingPermissions.delete(id);
    }
  }
}

export function createPermissionRequest(
  toolName: string,
  args: Record<string, unknown>,
  description: string,
  threadId: string,
): { requestId: string; promise: Promise<{ approved: boolean }> } {
  purgeStalePermissions();
  const requestId = generateRequestId();

  const permissionRequest: PermissionRequest = {
    requestId,
    toolName,
    args,
    description,
    threadId,
    approved: null,
    createdAt: Date.now(),
  };
  permissionStore.set(requestId, permissionRequest);

  const promise = new Promise<{ approved: boolean }>((resolve, reject) => {
    pendingPermissions.set(requestId, { resolve, reject });
  });

  return { requestId, promise };
}

export function resolvePermission(
  requestId: string,
  approved: boolean,
): boolean {
  const resolver = pendingPermissions.get(requestId);
  if (!resolver) return false;

  const stored = permissionStore.get(requestId);
  if (stored) {
    stored.approved = approved;
  }

  resolver.resolve({ approved });
  pendingPermissions.delete(requestId);
  return true;
}

export function getPendingPermissions(
  threadId?: string,
): PermissionRequest[] {
  const all: PermissionRequest[] = [];
  for (const req of permissionStore.values()) {
    if (req.approved !== null) continue;
    if (threadId && req.threadId !== threadId) continue;
    all.push(req);
  }
  return all;
}

/** Peek at a pending request without resolving (for allow-always scoping). */
export function getPermissionRequest(requestId: string): PermissionRequest | null {
  purgeStalePermissions();
  return permissionStore.get(requestId) ?? null;
}

type ToolCheckResult = {
  needsPermission: boolean;
  description: string;
};

const WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);

/** Access level a tool needs on an outside-workspace path. */
export function requiredAccessForTool(toolName: string): DirAccess {
  return WRITE_TOOLS.has(toolName) || toolName === "run_command" ? "write" : "read";
}

/** True when the target resolves inside a user-approved directory. */
function coveredByAllowedDir(
  toolName: string,
  pathArg: string,
  workspacePath: string,
): boolean {
  if (!pathArg) return false;
  try {
    const abs = toAbsoluteDir(pathArg, workspacePath);
    if (!abs) return false;
    // Inside the workspace is governed by workspace rules, not this list
    const rel = relative(workspacePath, abs);
    if (rel !== "" && !rel.startsWith("..")) return false;
    return allowedDirsStore.isAllowed(abs, requiredAccessForTool(toolName));
  } catch {
    return false;
  }
}

export function evaluateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  workspacePath: string,
): ToolCheckResult {
  const pathArg = (args.path as string) || (args.filepath as string) || "";
  const commandArg = args.command as string | undefined;

  // NOTE: Only paths outside the workspace (and not covered by an
  // Allowed directory) require permission. Everything inside the
  // workspace runs without prompting — including destructive shell
  // commands and web search/fetch.

  if (
    toolName === "run_command" &&
    commandArg &&
    args.cwd &&
    typeof args.cwd === "string"
  ) {
    const resolvedCwd = resolve(workspacePath, args.cwd);
    const rel = relative(workspacePath, resolvedCwd);
    if (rel.startsWith("..")) {
      if (coveredByAllowedDir(toolName, args.cwd, workspacePath)) {
        return { needsPermission: false, description: "" };
      }
      return {
        needsPermission: true,
        description: `Access files outside the project directory`,
      };
    }
  }

  if (pathArg && toolName !== "list_directory") {
    const resolvedPath = resolve(workspacePath, pathArg);
    const rel = relative(workspacePath, resolvedPath);
    if (rel.startsWith("..")) {
      if (coveredByAllowedDir(toolName, pathArg, workspacePath)) {
        return { needsPermission: false, description: "" };
      }
      return {
        needsPermission: true,
        description: `Access files outside the project directory`,
      };
    }
  }

  if (
    toolName === "write_file" ||
    toolName === "edit_file" ||
    toolName === "delete_file"
  ) {
    const resolvedPath = resolve(workspacePath, pathArg);
    const rel = relative(workspacePath, resolvedPath);
    if (rel.startsWith("..")) {
      if (coveredByAllowedDir(toolName, pathArg, workspacePath)) {
        return { needsPermission: false, description: "" };
      }
      return {
        needsPermission: true,
        description: `Access files outside the project directory`,
      };
    }
  }

  if (toolName === "list_directory" && pathArg) {
    const resolvedPath = resolve(workspacePath, pathArg);
    const rel = relative(workspacePath, resolvedPath);
    if (rel.startsWith("..") && !coveredByAllowedDir(toolName, pathArg, workspacePath)) {
      return {
        needsPermission: true,
        description: `Access files outside the project directory`,
      };
    }
  }

  return { needsPermission: false, description: "" };
}

export async function withPermissionCheck<T extends Record<string, unknown>>(
  toolName: string,
  args: T,
  threadId: string,
  execute: (args: T) => Promise<string>,
): Promise<string> {
  const workspacePath = getWorkspacePath();
  const evaluation = evaluateToolCall(toolName, args, workspacePath);

  if (!evaluation.needsPermission) {
    return execute(args);
  }

  const { promise } = createPermissionRequest(
    toolName,
    args as Record<string, unknown>,
    evaluation.description,
    threadId,
  );

  const timeoutMs = parseInt(process.env.PERMISSION_TIMEOUT_MS || "300000", 10);
  const timeoutPromise = new Promise<{ approved: boolean }>((_, reject) =>
    setTimeout(
      () => reject(new Error("Permission request timed out")),
      timeoutMs,
    ),
  );

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (result.approved) {
      return execute(args);
    }
    return "Operation not permitted.";
  } catch {
    return "Operation not permitted: permission request timed out or failed.";
  }
}

export function createTaskPermissionChecker(permissions: TaskPermissions) {
  const workspacePath = getWorkspacePath();

  return function checkTaskPermission(
    toolName: string,
    args: Record<string, unknown>,
  ): { allowed: boolean; reason?: string } {
    // Headless task gates run independently of the interactive prompt.
    // Interactive chat only prompts for outside-workspace paths, but
    // background tasks must still respect their own permission flags.
    if (toolName === "run_command") {
      const command = (args.command as string) || "";
      if (!permissions.runCommands) {
        return {
          allowed: false,
          reason: "Task does not have permission to run commands.",
        };
      }
      if (isDestructiveCommand(command) && !permissions.destructiveCommands) {
        return {
          allowed: false,
          reason:
            "Task does not have permission to run destructive commands.",
        };
      }
    }

    if (
      (toolName === "web_search" || toolName === "web_fetch") &&
      !permissions.webAccess
    ) {
      return {
        allowed: false,
        reason: "Task does not have permission to access the web.",
      };
    }

    if (
      (toolName === "list_external_directory" ||
        toolName === "read_external_file") &&
      !permissions.externalFiles
    ) {
      return {
        allowed: false,
        reason: "Task does not have permission to access external files.",
      };
    }

    const evaluation = evaluateToolCall(toolName, args, workspacePath);
    if (!evaluation.needsPermission) return { allowed: true };

    // Outside the workspace (and not in Allowed directories) — tasks
    // need externalFiles to proceed. No prompt headless, just deny.
    if (!permissions.externalFiles) {
      if (
        toolName === "write_file" ||
        toolName === "edit_file" ||
        toolName === "delete_file"
      ) {
        return {
          allowed: false,
          reason:
            "Task does not have permission to modify files outside workspace.",
        };
      }
      return {
        allowed: false,
        reason: "Task does not have permission to access external files.",
      };
    }

    return { allowed: true };
  };
}

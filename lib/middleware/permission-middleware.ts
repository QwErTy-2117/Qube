import { resolve, relative } from "node:path";
import { getWorkspacePath, isDestructiveCommand } from "./workspace";
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

export function createPermissionRequest(
  toolName: string,
  args: Record<string, unknown>,
  description: string,
  threadId: string,
): { requestId: string; promise: Promise<{ approved: boolean }> } {
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

type ToolCheckResult = {
  needsPermission: boolean;
  description: string;
};

export function evaluateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  workspacePath: string,
): ToolCheckResult {
  const pathArg = (args.path as string) || (args.filepath as string) || "";
  const commandArg = args.command as string | undefined;
  const urlArg = args.url as string | undefined;

  if (toolName === "run_command" && commandArg) {
    if (isDestructiveCommand(commandArg)) {
      return {
        needsPermission: true,
        description: `The agent wants to run: ${commandArg}`,
      };
    }
  }

  if (
    toolName === "run_command" &&
    commandArg &&
    args.cwd &&
    typeof args.cwd === "string"
  ) {
    const resolvedCwd = resolve(workspacePath, args.cwd);
    const rel = relative(workspacePath, resolvedCwd);
    if (rel.startsWith("..")) {
      return {
        needsPermission: true,
        description: `The agent wants to run a command outside the workspace: ${commandArg}`,
      };
    }
  }

  if (pathArg && toolName !== "list_directory") {
    const resolvedPath = resolve(workspacePath, pathArg);
    const rel = relative(workspacePath, resolvedPath);
    if (rel.startsWith("..")) {
      return {
        needsPermission: true,
        description: `The agent wants to access a path outside the workspace: ${pathArg}`,
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
      return {
        needsPermission: true,
        description: `The agent wants to modify a file outside the workspace: ${pathArg}`,
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
    const evaluation = evaluateToolCall(toolName, args, workspacePath);
    if (!evaluation.needsPermission) return { allowed: true };

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
      (toolName === "list_external_directory" ||
        toolName === "read_external_file") &&
      !permissions.externalFiles
    ) {
      return {
        allowed: false,
        reason: "Task does not have permission to access external files.",
      };
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

    if (toolName.startsWith("browser_") && !permissions.browserAccess) {
      return {
        allowed: false,
        reason: "Task does not have permission to use the browser.",
      };
    }

    if (
      (toolName === "write_file" ||
        toolName === "edit_file" ||
        toolName === "delete_file") &&
      !permissions.externalFiles
    ) {
      const pathArg = (args.path as string) || "";
      const rel = relative(workspacePath, resolve(workspacePath, pathArg));
      if (rel.startsWith("..")) {
        return {
          allowed: false,
          reason:
            "Task does not have permission to modify files outside workspace.",
        };
      }
    }

    return { allowed: true };
  };
}

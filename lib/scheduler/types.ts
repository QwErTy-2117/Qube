export type TaskScheduleKind = "interval" | "once";

export type TaskPermissions = {
  runCommands: boolean;
  destructiveCommands: boolean;
  externalFiles: boolean;
  webAccess: boolean;
  browserAccess: boolean;
};

export type ScheduledTask = {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: TaskScheduleKind;
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  permissions: TaskPermissions;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
};

export type TaskLogEntry = {
  timestamp: number;
  taskId: string;
  name: string;
  status: "success" | "error";
  output: string;
  duration: number;
};

export const DEFAULT_HEARTBEAT_INTERVAL = 30;

export function getDefaultHeartbeatTask(): ScheduledTask {
  const now = Date.now();
  return {
    id: "heartbeat",
    type: "heartbeat",
    name: "Heartbeat",
    instructions:
      "Review recent changes in the workspace, check for any pending work, and summarize the current state. If nothing needs attention, report that all is well.",
    schedule: { kind: "interval", intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL },
    enabled: true,
    permissions: {
      runCommands: true,
      destructiveCommands: false,
      externalFiles: false,
      webAccess: true,
      browserAccess: false,
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: now + DEFAULT_HEARTBEAT_INTERVAL * 60_000,
  };
}

export const DEFAULT_TASK_PERMISSIONS: TaskPermissions = {
  runCommands: false,
  destructiveCommands: false,
  externalFiles: false,
  webAccess: false,
  browserAccess: false,
};

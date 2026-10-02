export type TaskScheduleKind = "interval" | "once";

export type TaskPermissions = {
  runCommands: boolean;
  destructiveCommands: boolean;
  externalFiles: boolean;
  webAccess: boolean;
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
    hour?: number;
    minute?: number;
    weekdays?: number[];
    monthDay?: number;
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
      "Muse-style monitor: check workspace files (list_directory root) and connected apps (Gmail, GitHub, Calendar, Slack — READ-ONLY list/search/get) for fresh items the user should know next time they talk. Save each new finding once via update_heartbeat note with evidence + a draft reply/action (e.g. party emails -> notify + draft reply). Never repeat the same finding twice; never send/post/delete headless — draft only. If nothing new, stay quiet.",
    schedule: { kind: "interval", intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL },
    enabled: true,
    permissions: {
      runCommands: true,
      destructiveCommands: false,
      externalFiles: false,
      webAccess: true,
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
};

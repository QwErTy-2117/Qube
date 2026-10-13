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
      "Muse-style monitor with three lanes. (1) Check workspace files (list_directory root) and connected apps (Gmail, GitHub, Calendar, Slack — READ-ONLY list/search/get) for fresh items the user should know next time they talk. (2) Lane B prep is AUTHORIZED: reversible in-workspace work the user will clearly want (compile a pending paper/deck/sheet, tidy a folder, build a comparison table) — DO it now under documents/presentations/spreadsheets/images/code, then save ONE update_heartbeat note with the file path + what to ask next chat. (3) Lane C (send/post/delete/purchase) is NEVER headless — draft + file only, ask in next chat. Save each new finding once via update_heartbeat note with evidence + draft/file. Never repeat the same finding twice; never send/post/delete headless. If nothing new, stay quiet.",
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

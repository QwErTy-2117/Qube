/**
 * Shared Computer Use types.
 *
 * These types are deliberately dependency-free so both the server-side CUA
 * Driver integration (`lib/cua/*`) and the browser visualization layer can
 * import them. Nothing here may import Node built-ins.
 */

export type CuaScope = "window" | "desktop";

export type CuaActionKind =
  | "move"
  | "click"
  | "double_click"
  | "right_click"
  | "scroll"
  | "drag"
  | "type"
  | "key"
  | "observe"
  | "window"
  | "launch"
  | "clipboard"
  | "status";

export type CuaPoint = { x: number; y: number };

export type CuaTargetRef = {
  role?: string;
  label?: string;
  elementToken?: string;
};

/** One real action performed through CUA Driver, mirrored to the UI. */
export interface CuaActionEvent {
  /** Monotonic event id (per server process). */
  id: number;
  at: number;
  threadId: string;
  session: string;
  kind: CuaActionKind;
  /** Qube-facing tool name (e.g. computer_click). */
  tool: string;
  ok: boolean;
  app?: string;
  pid?: number;
  windowId?: number;
  windowTitle?: string;
  /** Coordinate frame for x/y/from/to. */
  scope?: CuaScope;
  /** Exact screenshot-pixel coordinates of the interaction. */
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  /** Natural size of the screenshot the coordinates refer to. */
  frameWidth?: number;
  frameHeight?: number;
  button?: "left" | "right" | "middle";
  text?: string;
  key?: string;
  keys?: string[];
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  by?: "line" | "page";
  target?: CuaTargetRef;
  /** Batch metadata for run_sequence replay ordering. */
  batchId?: string;
  stepIndex?: number;
  durationMs?: number;
  error?: string;
  /** Free-form safe metadata (never page/app content). */
  meta?: Record<string, unknown>;
}

export interface CuaFrameMeta {
  threadId: string;
  version: number;
  scope: CuaScope;
  at: number;
  width: number;
  height: number;
  mime: string;
  app?: string;
  pid?: number;
  windowId?: number;
  windowTitle?: string;
}

export interface CuaFrame extends CuaFrameMeta {
  base64: string;
}

export type CuaEventEnvelope =
  | { type: "action"; event: CuaActionEvent }
  | { type: "frame"; frame: CuaFrameMeta };

export interface CuaWindowRecord {
  pid: number;
  window_id: number;
  app_name?: string;
  title?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  z_index?: number | null;
  is_on_screen?: boolean;
  minimized?: boolean;
  layer?: number | null;
  on_current_space?: boolean;
  [key: string]: unknown;
}

export interface CuaElementFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CuaElement {
  element_index?: number;
  element_token?: string;
  role?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  selected?: boolean;
  actions?: string[];
  /** Screen coordinates reported by the platform. */
  frame?: CuaElementFrame;
  /** Window-local delivered-screenshot coordinates (preferred for UI). */
  screenshot_frame?: CuaElementFrame;
  parent_index?: number | null;
  depth?: number;
  [key: string]: unknown;
}

export interface CuaObservation {
  text: string;
  data: Record<string, unknown>;
  elements: CuaElement[];
  snapshotId?: string;
  pid?: number;
  windowId?: number;
  app?: string;
  title?: string;
  scope: CuaScope;
  width?: number;
  height?: number;
  frameScale?: number;
  screenshotBase64?: string;
  screenshotMime?: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
}

export type CuaActionResult = {
  data: Record<string, unknown>;
  text: string;
  raw: string;
};

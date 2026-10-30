/**
 * Computer Use service — the only place that talks to CUA Driver.
 *
 * Everything above this layer (agent tools, API routes, UI) deals in Qube
 * semantics: `computer_click`, `element_index`, `app`, observations. The
 * service resolves windows/elements, emits real action events for the
 * visualization, captures the exact delivered screenshot, and maps CUA's
 * typed tools onto the legacy model-facing surface.
 *
 * No other module may shell out to `cua-driver`.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CUA_ACTION_TOOLS,
  CUA_READ_ONLY_QUBE_TOOLS,
  cuaCursorMotionConfig,
  cuaDriverTimeoutMs,
  cuaSessionLabel,
} from "./config";
import {
  CuaDriver,
  CuaDriverError,
  CuaToolError,
  cuaErrorMessage,
  pngDimensions,
  translateCuaFailure,
  type ParsedCuaOutput,
} from "./driver";
import { cuaEventHub, cuaFrameStore } from "./events";
import {
  dragFromLegacy,
  isLegacyImmediateTool,
  isLegacyObservationTool,
  legacyActionTool,
  normalizeElementIndex,
  parseKeyChord,
  scrollFromLegacy,
  translateLegacyAction,
  validateSequenceCalls,
  type CuaSequenceStep,
  type LegacySequenceCall,
} from "./sequence";
import type {
  CuaActionEvent,
  CuaActionKind,
  CuaActionResult,
  CuaElement,
  CuaElementFrame,
  CuaObservation,
  CuaScope,
  CuaWindowRecord,
} from "./types";

type Rect = { x: number; y: number; width: number; height: number };

export type CuaTarget = {
  pid: number;
  windowId?: number;
  app?: string;
  title?: string;
  bounds?: Rect;
  scope: "window";
};

export type CuaDesktopTarget = { scope: "desktop" };

export type ObserveWindowInput = {
  pid?: number;
  window_id?: number;
  app?: string;
  window?: string;
  max_elements?: number;
  max_depth?: number;
  query?: string;
  include_screenshot?: boolean;
  /** Reuse an existing observation rather than re-reading a window. */
  reuse?: boolean;
};

export type RunSequenceInput = {
  calls?: unknown;
  steps?: unknown;
  sleep?: unknown;
  observe?: unknown;
  app?: string;
  window?: string;
  label?: string;
};

type StepPlan = {
  tool: string;
  kind: CuaActionKind;
  scope: CuaScope;
  target: CuaTarget | null;
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  text?: string;
  key?: string;
  keys?: string[];
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  by?: "line" | "page";
  button?: "left" | "right" | "middle";
  element?: CuaElement;
  observation?: CuaObservation;
};

const MAX_ELEMENTS = 1200;
const MAX_OBSERVATION_TEXT = 60000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toActionResult(output: ParsedCuaOutput): CuaActionResult {
  return {
    data: output.data ?? {},
    text: output.text,
    raw: output.raw,
  };
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveInt(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? Math.round(n) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(value: unknown): Rect | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const x = finite(rec.x ?? rec.left);
  const y = finite(rec.y ?? rec.top);
  const w = finite(rec.width ?? rec.w);
  const h = finite(rec.height ?? rec.h);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h };
}

function normalizeElementFrame(value: unknown): CuaElementFrame | null {
  const rect = normalizeRect(value);
  if (!rect) return null;
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

function normalizeWindow(raw: unknown): CuaWindowRecord | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const pid = positiveInt(rec.pid);
  const windowId = finite(rec.window_id ?? rec.id);
  if (pid === null || windowId === null) return null;
  const bounds = normalizeRect(rec.bounds ?? rec.frame);
  return {
    ...rec,
    pid,
    window_id: Math.round(windowId),
    app_name:
      (typeof rec.app_name === "string" && rec.app_name) ||
      (typeof rec.app === "string" && rec.app) ||
      (typeof rec.name === "string" && rec.name) ||
      undefined,
    title: typeof rec.title === "string" ? rec.title : undefined,
    bounds: bounds ?? undefined,
  };
}

function normalizeElement(raw: unknown): CuaElement | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const token = typeof rec.element_token === "string" ? rec.element_token : undefined;
  const index =
    normalizeElementIndex(rec.element_index ?? rec.index ?? rec.row) ??
    (token ? elementIndexFromToken(token) : null);
  if (index === null && !token) return null;
  return {
    ...rec,
    ...(index !== null ? { element_index: index } : {}),
    ...(token ? { element_token: token } : {}),
    frame: normalizeElementFrame(rec.frame) ?? undefined,
    screenshot_frame: normalizeElementFrame(rec.screenshot_frame) ?? undefined,
  };
}

function elementIndexFromToken(token: string): number | null {
  // CUA element tokens are `<snapshot_id>:<index>`; snapshot ids are opaque
  // and may change format, so only rely on the numeric suffix.
  const m = /:(\d+)$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

function summarizeStep(step: CuaSequenceStep): string {
  const args = step.args || {};
  if (typeof args.text === "string" && args.text) return `${step.tool}: ${args.text.slice(0, 60)}`;
  if (typeof args.key === "string") return `${step.tool}: ${args.key}`;
  if (Array.isArray(args.keys)) return `${step.tool}: ${args.keys.join("+")}`;
  if (typeof args.direction === "string") return `${step.tool}: ${args.direction} ${args.amount ?? 3}`;
  if (typeof args.value === "string") return `${step.tool}: ${args.value.slice(0, 60)}`;
  return step.tool;
}

/**
 * CUA service for one chat thread. Create one per agent run; it owns the
 * named session, the recent observation/element cache, and event emission.
 */
export class CuaService {
  readonly threadId: string;
  readonly session: string;
  readonly driver: CuaDriver;

  private sessionReady: Promise<void> | null = null;
  private lastTarget: CuaTarget | null = null;
  private observations: CuaObservation[] = [];
  /** While > 0, observations queue their frame/event for the next flush. */
  private deferObservationEvents = 0;
  private pendingObservationEvents: CuaObservation[] = [];

  constructor(threadId: string, opts: { driver?: CuaDriver; session?: string } = {}) {
    this.threadId = threadId || "default";
    this.session = opts.session || cuaSessionLabel(this.threadId);
    this.driver = opts.driver || new CuaDriver();
  }

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------

  async ensureSession(): Promise<void> {
    if (this.sessionReady) return this.sessionReady;
    this.sessionReady = (async () => {
      const motion = cuaCursorMotionConfig();
      await this.driver.call(
        "start_session",
        { session: this.session, cursor_motion: motion },
        { timeoutMs: Math.max(15000, cuaDriverTimeoutMs()) },
      );
      // Native cursor config is best-effort: an older driver may not expose
      // every effect, but computer control must still work.
      try {
        await this.driver.call("set_agent_cursor_motion", {
          session: this.session,
          ...motion,
        });
      } catch (error) {
        console.warn(
          `[cua] could not configure native cursor (non-fatal): ${cuaErrorMessage(error)}`,
        );
      }
    })().catch((error) => {
      this.sessionReady = null;
      throw error;
    });
    return this.sessionReady;
  }

  private async call(
    tool: string,
    args: Record<string, unknown> = {},
    opts: { timeoutMs?: number; screenshotOutFile?: string } = {},
  ): Promise<ParsedCuaOutput> {
    await this.ensureSession();
    try {
      return await this.driver.call(tool, { ...args, session: this.session }, opts);
    } catch (error) {
      // A daemon restart or an idle session reaper can end the named session.
      // The call never ran in that case, so one fresh session + retry is safe.
      const message = cuaErrorMessage(error);
      if (
        error instanceof CuaDriverError &&
        (error.code === "session_ended" ||
          /session.*(ended|expired|not found|unknown|invalid)|no such session/i.test(message))
      ) {
        this.sessionReady = null;
        await this.ensureSession();
        return this.driver.call(tool, { ...args, session: this.session }, opts);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // Observation / window resolution
  // ---------------------------------------------------------------------

  async listApps(): Promise<Record<string, unknown>[]> {
    const result = await this.call("list_apps", {});
    const apps = Array.isArray(result.data?.apps) ? result.data.apps : [];
    return apps.filter((app): app is Record<string, unknown> => !!asRecord(app));
  }

  async listWindows(params: {
    pid?: number;
    app?: string;
    on_screen_only?: boolean;
  } = {}): Promise<CuaWindowRecord[]> {
    const args: Record<string, unknown> = {};
    if (params.pid) args.pid = params.pid;
    if (params.app) args.app = params.app;
    if (params.on_screen_only !== undefined) args.on_screen_only = params.on_screen_only;
    const result = await this.call("list_windows", args);
    const raw = result.data?.windows;
    const windows = Array.isArray(raw) ? raw : Array.isArray(result.data) ? result.data : [];
    return windows
      .map((window) => normalizeWindow(window))
      .filter((window): window is CuaWindowRecord => !!window);
  }

  private chooseWindow(windows: CuaWindowRecord[], title?: string): CuaWindowRecord | null {
    if (windows.length === 0) return null;
    let list = windows;
    if (title) {
      const lower = title.toLowerCase();
      const matches = list.filter((w) => String(w.title || "").toLowerCase().includes(lower));
      if (matches.length > 0) list = matches;
    }
    const visible = list.filter((w) => w.is_on_screen !== false && w.minimized !== true);
    const pool = visible.length > 0 ? visible : list;
    return [...pool].sort((a, b) => {
      const area = (w: CuaWindowRecord) => (w.bounds?.width ?? 0) * (w.bounds?.height ?? 0);
      return area(b) - area(a);
    })[0] ?? null;
  }

  /**
   * Resolve a model-supplied app/pid/window to one concrete CUA window.
   * `null` means no target was supplied and no prior observation exists.
   */
  async resolveTarget(
    input: { pid?: unknown; window_id?: unknown; app?: unknown; window?: unknown },
    opts: { fallbackLast?: boolean } = {},
  ): Promise<CuaTarget | null> {
    const pid = positiveInt(input.pid);
    const windowId = finite(input.window_id);
    const app = typeof input.app === "string" ? input.app.trim() : "";
    const windowTitle = typeof input.window === "string" ? input.window.trim() : "";

    if (pid !== null && windowId !== null) {
      return {
        pid,
        windowId: Math.round(windowId),
        app: app || undefined,
        title: windowTitle || undefined,
        scope: "window",
      };
    }

    if (windowId !== null && pid === null) {
      const windows = await this.listWindows({});
      const chosen = windows.find((w) => w.window_id === Math.round(windowId));
      if (chosen) {
        return {
          pid: chosen.pid,
          windowId: chosen.window_id,
          app: chosen.app_name || undefined,
          title: chosen.title || windowTitle || undefined,
          bounds: chosen.bounds,
          scope: "window",
        };
      }
      throw new CuaDriverError(
        `No window with id ${Math.round(windowId)}.`,
        "target_not_found",
        "Run computer_list_windows for current window ids, then retry.",
      );
    }

    if (pid !== null) {
      const windows = await this.listWindows({ pid });
      const chosen = this.chooseWindow(windows, windowTitle);
      if (chosen) {
        return {
          pid: chosen.pid,
          windowId: chosen.window_id,
          app: chosen.app_name || app || undefined,
          title: chosen.title || windowTitle || undefined,
          bounds: chosen.bounds,
          scope: "window",
        };
      }
      // Let CUA choose the pid's focused/largest window when enumeration is
      // unavailable (e.g. a permission-limited environment).
      return { pid, app: app || undefined, title: windowTitle || undefined, scope: "window" };
    }

    if (app || windowTitle) {
      let windows = await this.listWindows({ app: app || undefined });
      if (windowTitle) {
        const lower = windowTitle.toLowerCase();
        windows = windows.filter((w) => String(w.title || "").toLowerCase().includes(lower));
      }
      const chosen = this.chooseWindow(windows, windowTitle);
      if (chosen) {
        return {
          pid: chosen.pid,
          windowId: chosen.window_id,
          app: chosen.app_name || app || undefined,
          title: chosen.title || windowTitle || undefined,
          bounds: chosen.bounds,
          scope: "window",
        };
      }
      const apps = await this.listApps();
      const appExists = app
        ? apps.some((a) => String(a.name || "").toLowerCase().includes(app.toLowerCase()))
        : true;
      throw new CuaDriverError(
        `No window found${app ? ` for app "${app}"` : ""}${windowTitle ? ` titled "${windowTitle}"` : ""}.`,
        "target_not_found",
        appExists
          ? "The app is running but has no window yet. Launch/open it or call computer_activate_window, then retry."
          : "Run computer_list_apps for exact names, launch the app with computer_launch_app, then retry.",
      );
    }

    if (opts.fallbackLast !== false && this.lastTarget) return this.lastTarget;
    return null;
  }

  private rememberTarget(target: CuaTarget): void {
    this.lastTarget = target;
  }

  private rememberObservation(obs: CuaObservation): void {
    this.observations.unshift(obs);
    if (this.observations.length > 12) this.observations.length = 12;
  }

  private observationFor(target: CuaTarget | null): CuaObservation | null {
    if (!target) return this.observations[0] ?? null;
    for (const obs of this.observations) {
      if (obs.pid !== target.pid) continue;
      if (target.windowId && obs.windowId && obs.windowId !== target.windowId) continue;
      if (obs.scope === "window") return obs;
    }
    return null;
  }

  private buildObservation(
    data: Record<string, unknown> | null,
    text: string,
    target: CuaTarget | null,
    width: number | undefined,
    height: number | undefined,
    base64: string | undefined,
    mime: string | undefined,
    scope: CuaScope,
  ): CuaObservation {
    const rawElements = Array.isArray(data?.elements) ? data.elements : [];
    const elements = rawElements
      .map((el) => normalizeElement(el))
      .filter((el): el is CuaElement => !!el);
    const pid = positiveInt(data?.pid) ?? target?.pid;
    const windowId = finite(data?.window_id) ?? target?.windowId;
    const app =
      (typeof data?.app_name === "string" && data.app_name) ||
      target?.app ||
      undefined;
    const title =
      (typeof data?.window_title === "string" && data.window_title) ||
      target?.title ||
      undefined;
    const bounds = normalizeRect(data?.window_bounds) ?? target?.bounds;
    return {
      text,
      data: data ?? {},
      elements,
      snapshotId: typeof data?.snapshot_id === "string" ? data.snapshot_id : undefined,
      pid,
      windowId: windowId !== null && windowId !== undefined ? Math.round(windowId) : undefined,
      app,
      title,
      scope,
      width: width ?? finite(data?.screenshot_width) ?? undefined,
      height: height ?? finite(data?.screenshot_height) ?? undefined,
      frameScale: finite(data?.frame_scale) ?? undefined,
      screenshotBase64: base64,
      screenshotMime: mime,
      windowBounds: bounds ?? undefined,
    };
  }

  private async capturePng(
    data: Record<string, unknown> | null,
    tempPath: string,
  ): Promise<{ base64?: string; mime?: string; width?: number; height?: number }> {
    const candidates = [
      tempPath,
      typeof data?.screenshot_file_path === "string" ? data.screenshot_file_path : "",
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const info = await stat(candidate);
        if (!info.isFile() || info.size <= 8) continue;
        const buffer = await readFile(candidate);
        const size = pngDimensions(buffer);
        return {
          base64: buffer.toString("base64"),
          mime: "image/png",
          width: size?.width,
          height: size?.height,
        };
      } catch {}
    }
    if (typeof data?.screenshot_png_b64 === "string" && data.screenshot_png_b64) {
      const base64 = data.screenshot_png_b64;
      const buffer = Buffer.from(base64, "base64");
      const size = pngDimensions(buffer);
      return {
        base64,
        mime: typeof data?.screenshot_mime_type === "string" ? data.screenshot_mime_type : "image/png",
        width: size?.width,
        height: size?.height,
      };
    }
    return {};
  }

  private withTempDir<T>(fn: (dir: string, pngPath: string) => Promise<T>): Promise<T> {
    return (async () => {
      const dir = await mkdtemp(join(tmpdir(), "qube-cua-"));
      try {
        return await fn(dir, join(dir, "shot.png"));
      } finally {
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {}
      }
    })();
  }

  async observeWindow(input: ObserveWindowInput): Promise<CuaObservation> {
    const target = await this.resolveTarget(input);
    if (!target || !target.pid) {
      throw new CuaDriverError(
        "No app/window specified. Call computer_list_apps or computer_list_windows first.",
        "target_not_found",
        "Pass app (or pid/window_id) to observe a specific application window.",
      );
    }
    if (input.reuse) {
      const cached = this.observationFor(target);
      if (cached) return cached;
    }

    const args: Record<string, unknown> = {
      pid: target.pid,
      tree_format: "both",
      include_screenshot: true,
      max_elements: clamp(input.max_elements ?? MAX_ELEMENTS, 1, 5000),
      // CUA defaults to a 1s AT-SPI walk; large Electron/GTK apps need more
      // to return the elements the model must click.
      timeout_ms: 5000,
    };
    if (target.windowId) args.window_id = target.windowId;
    if (input.max_depth) args.max_depth = clamp(input.max_depth, 1, 64);
    if (input.query) args.query = input.query;

    const result = await this.withTempDir(async (_dir, pngPath) => {
      args.screenshot_out_file = pngPath;
      const output = await this.call("get_window_state", args, {
        timeoutMs: Math.max(20000, cuaDriverTimeoutMs()),
      });
      const png = await this.capturePng(output.data, pngPath);
      return { output, png };
    });

    const text =
      result.output.text ||
      (typeof result.output.data?.tree_markdown === "string"
        ? result.output.data.tree_markdown
        : "");
    const observation = this.buildObservation(
      result.output.data,
      text,
      target,
      result.png.width,
      result.png.height,
      result.png.base64,
      result.png.mime,
      "window",
    );

    if (observation.pid && observation.windowId) {
      this.rememberTarget({
        pid: observation.pid,
        windowId: observation.windowId,
        app: observation.app,
        title: observation.title,
        bounds: observation.windowBounds,
        scope: "window",
      });
    } else {
      this.rememberTarget(target);
    }
    this.rememberObservation(observation);
    if (this.deferObservationEvents > 0) {
      this.pendingObservationEvents.push(observation);
    } else {
      this.storeFrame(observation);
      this.emit({
        kind: "observe",
        tool: "computer_get_app_state",
        ok: true,
        app: observation.app,
        pid: observation.pid,
        windowId: observation.windowId,
        windowTitle: observation.title,
        scope: "window",
        frameWidth: observation.width,
        frameHeight: observation.height,
        meta: { elements: observation.elements.length, snapshotId: observation.snapshotId },
      });
    }
    return observation;
  }

  async observeDesktop(input: { max_image_dimension?: number } = {}): Promise<CuaObservation> {
    const args: Record<string, unknown> = {};
    if (input.max_image_dimension) args.max_image_dimension = input.max_image_dimension;
    const result = await this.withTempDir(async (_dir, pngPath) => {
      args.screenshot_out_file = pngPath;
      const output = await this.call("get_desktop_state", args, {
        timeoutMs: Math.max(20000, cuaDriverTimeoutMs()),
      });
      const png = await this.capturePng(output.data, pngPath);
      return { output, png };
    });
    const observation = this.buildObservation(
      result.output.data,
      result.output.text,
      null,
      result.png.width,
      result.png.height,
      result.png.base64,
      result.png.mime,
      "desktop",
    );
    this.rememberObservation(observation);
    if (this.deferObservationEvents > 0) {
      this.pendingObservationEvents.push(observation);
    } else {
      this.storeFrame(observation);
      this.emit({
        kind: "observe",
        tool: "computer_get_desktop_state",
        ok: true,
        scope: "desktop",
        frameWidth: observation.width,
        frameHeight: observation.height,
      });
    }
    return observation;
  }

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------

  private elementFromObservation(obs: CuaObservation | null, index: number): CuaElement | null {
    if (!obs) return null;
    return obs.elements.find((el) => el.element_index === index) ?? null;
  }

  private elementByToken(token: string): { element: CuaElement | null; observation: CuaObservation | null } {
    for (const obs of this.observations) {
      const element =
        obs.elements.find((el) => el.element_token === token) ??
        (() => {
          const index = elementIndexFromToken(token);
          return index !== null ? obs.elements.find((el) => el.element_index === index) ?? null : null;
        })();
      if (element) return { element, observation: obs };
    }
    return { element: null, observation: null };
  }

  private elementFrame(el: CuaElement | null, obs: CuaObservation | null): CuaElementFrame | null {
    if (!el) return null;
    if (el.screenshot_frame) return el.screenshot_frame;
    if (el.frame && obs?.windowBounds && obs.width && obs.height) {
      const b = obs.windowBounds;
      const sx = obs.width / Math.max(1, b.width);
      const sy = obs.height / Math.max(1, b.height);
      return {
        x: (el.frame.x - b.x) * sx,
        y: (el.frame.y - b.y) * sy,
        w: el.frame.w * sx,
        h: el.frame.h * sy,
      };
    }
    return null;
  }

  private elementCenter(
    el: CuaElement | null,
    obs: CuaObservation | null,
  ): { x: number; y: number } | null {
    const frame = this.elementFrame(el, obs);
    if (!frame) return null;
    return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  }

  /**
   * Resolve element_index/element_token to a token plus its on-screen frame.
   * A provided token is never re-observed (a new snapshot would invalidate
   * it); we only look it up in the cache for the visualization coordinates.
   */
  private async resolveElement(
    args: Record<string, unknown>,
    target: CuaTarget | null,
    opts: { allowObserve?: boolean } = {},
  ): Promise<{
    token: string | null;
    element: CuaElement | null;
    observation: CuaObservation | null;
  }> {
    const explicitToken =
      typeof args.element_token === "string" && args.element_token.trim()
        ? args.element_token.trim()
        : typeof args.token === "string" && args.token.trim()
          ? args.token.trim()
          : null;
    const index = normalizeElementIndex(
      args.element_index ?? args.index ?? args.row ?? args.element,
    );

    if (explicitToken) {
      const found = this.elementByToken(explicitToken);
      return { token: explicitToken, element: found.element, observation: found.observation };
    }
    if (index === null) return { token: null, element: null, observation: null };

    let obs = this.observationFor(target);
    let element = this.elementFromObservation(obs, index);
    if (!element && opts.allowObserve !== false && target) {
      obs = await this.observeWindow({
        pid: target.pid,
        window_id: target.windowId,
        app: target.app,
        window: target.title,
      });
      element = this.elementFromObservation(obs, index);
    }
    if (!element) {
      throw new CuaDriverError(
        `Element [${index}] is not present in the current window state.`,
        "element_not_found",
        "Run computer_get_app_state for this app, then retry with an element_index from the fresh tree.",
        { element_index: index },
      );
    }
    const token =
      element.element_token ??
      (obs?.snapshotId ? `${obs.snapshotId}:${index}` : null);
    if (!token) {
      throw new CuaDriverError(
        `Element [${index}] has no usable element token.`,
        "element_not_found",
        "Re-run computer_get_app_state and use a listed element_index.",
      );
    }
    return { token, element, observation: obs };
  }

  // ---------------------------------------------------------------------
  // Events / frames
  // ---------------------------------------------------------------------

  private storeFrame(obs: CuaObservation): void {
    if (!obs.screenshotBase64 || !obs.width || !obs.height) return;
    try {
      cuaFrameStore.put({
        threadId: this.threadId,
        scope: obs.scope,
        width: obs.width,
        height: obs.height,
        mime: obs.screenshotMime || "image/png",
        base64: obs.screenshotBase64,
        app: obs.app,
        pid: obs.pid,
        windowId: obs.windowId,
        windowTitle: obs.title,
      });
    } catch (error) {
      console.warn(`[cua] could not store screenshot frame: ${cuaErrorMessage(error)}`);
    }
  }

  private emit(
    event: Omit<CuaActionEvent, "id" | "at" | "threadId" | "session"> & {
      threadId?: string;
      session?: string;
    },
  ): void {
    try {
      cuaEventHub.publishAction({
        ...event,
        threadId: event.threadId || this.threadId,
        session: event.session || this.session,
      });
    } catch {}
  }

  private publishFailure(
    tool: string,
    kind: CuaActionKind,
    target: CuaTarget | null,
    error: unknown,
    extra: Partial<CuaActionEvent> = {},
  ): void {
    this.emit({
      kind,
      tool,
      ok: false,
      app: target?.app,
      pid: target?.pid,
      windowId: target?.windowId,
      windowTitle: target?.title,
      scope: "window",
      error: cuaErrorMessage(error).slice(0, 600),
      ...extra,
    });
  }

  // ---------------------------------------------------------------------
  // Action engine
  // ---------------------------------------------------------------------

  private targetArgs(target: CuaTarget | null, scope: CuaScope): Record<string, unknown> {
    if (scope === "desktop") return { scope: "desktop" };
    if (!target) return {};
    const out: Record<string, unknown> = { pid: target.pid };
    if (target.windowId) out.window_id = target.windowId;
    return out;
  }

  private scopeFromArgs(args: Record<string, unknown>): CuaScope {
    return args.scope === "desktop" || args.coordinate_frame === "desktop"
      ? "desktop"
      : "window";
  }

  private normalizeButton(value: unknown): "left" | "right" | "middle" {
    return value === "right" || value === "middle" ? value : "left";
  }

  private resultPoint(data: Record<string, unknown> | null): { x: number; y: number } | null {
    if (!data) return null;
    for (const key of ["window_point", "click_point", "point", "cursor", "position"]) {
      const rec = asRecord(data[key]);
      if (rec) {
        const x = finite(rec.x);
        const y = finite(rec.y);
        if (x !== null && y !== null) return { x, y };
      }
    }
    const x = finite(data.x ?? data.window_x);
    const y = finite(data.y ?? data.window_y);
    return x !== null && y !== null ? { x, y } : null;
  }

  /**
   * Run one real CUA action and mirror it. Failure events are emitted so the
   * panel can show the error, but the visualization never animates a failed
   * action.
   */
  private async perform(
    tool: string,
    kind: CuaActionKind,
    args: Record<string, unknown>,
    target: CuaTarget | null,
    event: {
      scope?: CuaScope;
      x?: number;
      y?: number;
      fromX?: number;
      fromY?: number;
      toX?: number;
      toY?: number;
      text?: string;
      key?: string;
      keys?: string[];
      direction?: "up" | "down" | "left" | "right";
      amount?: number;
      by?: "line" | "page";
      button?: "left" | "right" | "middle";
      element?: CuaElement;
      observation?: CuaObservation;
      batchId?: string;
      stepIndex?: number;
      durationMs?: number;
    } = {},
  ): Promise<CuaActionResult> {
    const observation = event.observation ?? this.observationFor(target);
    const scope = event.scope ?? "window";
    try {
      const result = await this.call(tool, args, {
        timeoutMs: Math.max(30000, cuaDriverTimeoutMs()),
      });
      const point = this.resultPoint(result.data);
      this.emit({
        kind,
        tool,
        ok: true,
        app: target?.app ?? observation?.app,
        pid: target?.pid ?? observation?.pid,
        windowId: target?.windowId ?? observation?.windowId,
        windowTitle: target?.title ?? observation?.title,
        scope,
        x: event.x ?? point?.x,
        y: event.y ?? point?.y,
        fromX: event.fromX,
        fromY: event.fromY,
        toX: event.toX,
        toY: event.toY,
        frameWidth: observation?.width,
        frameHeight: observation?.height,
        text: event.text,
        key: event.key,
        keys: event.keys,
        direction: event.direction,
        amount: event.amount,
        by: event.by,
        button: event.button,
        target: event.element
          ? {
              role: typeof event.element.role === "string" ? event.element.role : undefined,
              label:
                typeof event.element.label === "string"
                  ? event.element.label
                  : typeof event.element.name === "string"
                    ? (event.element.name as string)
                    : undefined,
              elementToken:
                typeof event.element.element_token === "string"
                  ? event.element.element_token
                  : undefined,
            }
          : undefined,
        batchId: event.batchId,
        stepIndex: event.stepIndex,
        durationMs: event.durationMs,
      });
      return {
        data: result.data ?? {},
        text: result.text,
        raw: result.raw,
      };
    } catch (error) {
      this.publishFailure(tool, kind, target, error, {
        x: event.x,
        y: event.y,
        scope,
        frameWidth: observation?.width,
        frameHeight: observation?.height,
        batchId: event.batchId,
        stepIndex: event.stepIndex,
      });
      throw error;
    }
  }

  private async prepareWindowAction(
    args: Record<string, unknown>,
    opts: { requireTarget?: boolean; preferPixel?: boolean } = {},
  ): Promise<{
    target: CuaTarget | null;
    scope: CuaScope;
    token: string | null;
    element: CuaElement | null;
    observation: CuaObservation | null;
    point: { x: number; y: number } | null;
  }> {
    const scope = this.scopeFromArgs(args);
    const target =
      scope === "desktop"
        ? null
        : await this.resolveTarget(args);
    if (scope === "window" && opts.requireTarget !== false && !target) {
      const explicitToken = typeof args.element_token === "string" ? args.element_token : "";
      if (!explicitToken) {
        throw new CuaDriverError(
          "No target window. Pass app, pid, or window_id.",
          "target_not_found",
          "Call computer_list_apps / computer_list_windows first, then include app or pid in this call.",
        );
      }
    }
    const hasPoint = finite(args.x) !== null && finite(args.y) !== null;
    // When explicit pixels are supplied, they win over an element index so
    // the action (and its mirror) land exactly where the model asked. Only
    // set_value needs the token regardless, because CUA has no pixel mode.
    const resolved =
      hasPoint && opts.preferPixel !== false
        ? {
            token: null,
            element: null,
            observation:
              scope === "desktop"
                ? this.observations.find((obs) => obs.scope === "desktop") ?? null
                : this.observationFor(target),
          }
        : await this.resolveElement(args, target);
    const point = hasPoint
      ? { x: Number(args.x), y: Number(args.y) }
      : this.elementCenter(resolved.element, resolved.observation);
    const observation =
      scope === "desktop"
        ? this.observations.find((obs) => obs.scope === "desktop") ?? null
        : resolved.observation ?? this.observationFor(target);
    return {
      target,
      scope,
      token: resolved.token,
      element: resolved.element,
      observation,
      point,
    };
  }

  // ---------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------

  async click(
    args: Record<string, unknown>,
    opts: { button?: "left" | "right" | "middle"; tool?: string } = {},
  ): Promise<CuaActionResult> {
    const prepared = await this.prepareWindowAction(args);
    const button = opts.button ?? this.normalizeButton(args.button);
    const count = Math.round(
      clamp(finite(args.count) ?? (opts.tool === "computer_secondary_action" ? 1 : 1), 1, 3),
    );
    const toolName =
      opts.button === "right" || opts.tool === "computer_secondary_action"
        ? "right_click"
        : count > 1
          ? "double_click"
          : "click";
    const kind: CuaActionKind =
      toolName === "right_click" ? "right_click" : count > 1 ? "double_click" : "click";

    // CUA's double_click/right_click schemas have no count/button fields.
    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
    };
    if (toolName === "click") {
      callArgs.button = button;
      callArgs.count = count;
    }
    if (prepared.token) callArgs.element_token = prepared.token;
    else if (prepared.point) {
      callArgs.x = prepared.point.x;
      callArgs.y = prepared.point.y;
    }
    if (typeof args.delivery_mode === "string") callArgs.delivery_mode = args.delivery_mode;
    if (Array.isArray(args.modifier)) callArgs.modifier = args.modifier;
    else if (Array.isArray(args.modifiers)) callArgs.modifier = args.modifiers;
    if (prepared.scope === "desktop") callArgs.scope = "desktop";
    return this.perform(toolName, kind, callArgs, prepared.target, {
      scope: prepared.scope,
      x: prepared.point?.x,
      y: prepared.point?.y,
      button,
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  async typeText(args: Record<string, unknown>): Promise<CuaActionResult> {
    const text = String(args.text ?? "");
    if (!text) {
      throw new CuaDriverError("type_text needs a text value.", "invalid_args", "Pass text to type.");
    }
    const prepared = await this.prepareWindowAction(args);
    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
      text: text.slice(0, 100000),
    };
    if (prepared.token) callArgs.element_token = prepared.token;
    else if (prepared.point) {
      callArgs.x = prepared.point.x;
      callArgs.y = prepared.point.y;
    }
    if (typeof args.delivery_mode === "string") callArgs.delivery_mode = args.delivery_mode;
    if (prepared.scope === "desktop") callArgs.scope = "desktop";
    return this.perform("type_text", "type", callArgs, prepared.target, {
      scope: prepared.scope,
      x: prepared.point?.x,
      y: prepared.point?.y,
      text: text.slice(0, 160),
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  async pressKey(args: Record<string, unknown>): Promise<CuaActionResult> {
    const prepared = await this.prepareWindowAction(args);
    const arrayKeys = Array.isArray(args.keys) ? args.keys.map((k) => String(k)).filter(Boolean) : [];
    const rawKey =
      typeof args.key === "string"
        ? args.key
        : arrayKeys.length === 1
          ? arrayKeys[0]
          : arrayKeys.join("+");
    const chord = parseKeyChord(rawKey);
    const explicitModifiers = Array.isArray(args.modifiers)
      ? args.modifiers.map((m) => String(m))
      : [];
    const modifiers = [...new Set([...chord.modifiers, ...explicitModifiers])];
    // A single key plus explicit modifiers is a hotkey in CUA terms.
    const chordKey = chord.key || (explicitModifiers.length === 0 ? rawKey.trim() : "");
    if (!chordKey && !Array.isArray(args.keys)) {
      throw new CuaDriverError(
        "press_key needs a key (e.g. \"return\" or \"ctrl+s\").",
        "invalid_args",
        "Pass key: \"return\", \"tab\", or a chord like \"ctrl+s\".",
      );
    }

    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
    };
    if (prepared.token) callArgs.element_token = prepared.token;
    else if (prepared.point) {
      callArgs.x = prepared.point.x;
      callArgs.y = prepared.point.y;
    }
    if (typeof args.delivery_mode === "string") callArgs.delivery_mode = args.delivery_mode;
    if (prepared.scope === "desktop") callArgs.scope = "desktop";

    let toolName = "press_key";
    let keys: string[] | undefined;
    if (arrayKeys.length >= 2) {
      toolName = "hotkey";
      keys = arrayKeys;
      callArgs.keys = arrayKeys;
    } else if (modifiers.length > 0 && chordKey) {
      toolName = "hotkey";
      keys = [...modifiers, chordKey];
      callArgs.keys = keys;
    } else {
      callArgs.key = chordKey;
    }
    return this.perform(toolName, "key", callArgs, prepared.target, {
      scope: prepared.scope,
      x: prepared.point?.x,
      y: prepared.point?.y,
      key: chordKey || (keys ? keys[keys.length - 1] : undefined),
      keys,
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  async scroll(args: Record<string, unknown>): Promise<CuaActionResult> {
    const prepared = await this.prepareWindowAction(args);
    const scroll = scrollFromLegacy(args);
    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
      direction: scroll.direction,
      amount: scroll.amount,
      by: scroll.by,
    };
    if (prepared.token) callArgs.element_token = prepared.token;
    else if (prepared.point) {
      callArgs.x = prepared.point.x;
      callArgs.y = prepared.point.y;
    }
    if (typeof args.delivery_mode === "string") callArgs.delivery_mode = args.delivery_mode;
    if (prepared.scope === "desktop") {
      if (!prepared.point) {
        throw new CuaDriverError(
          "Desktop scrolling needs x/y screenshot pixels.",
          "invalid_args",
          "Pass x,y from computer_get_desktop_state, or target a window instead.",
        );
      }
      callArgs.scope = "desktop";
    }
    return this.perform("scroll", "scroll", callArgs, prepared.target, {
      scope: prepared.scope,
      x: prepared.point?.x,
      y: prepared.point?.y,
      direction: scroll.direction,
      amount: scroll.amount,
      by: scroll.by,
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  async drag(args: Record<string, unknown>): Promise<CuaActionResult> {
    const drag = dragFromLegacy(args);
    if (!drag) {
      throw new CuaDriverError(
        "drag needs from_x/from_y + to_x/to_y (or start/end aliases).",
        "invalid_args",
        "Use window-local screenshot pixels from computer_get_app_state.",
      );
    }
    const prepared = await this.prepareWindowAction(args);
    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
      ...drag,
    };
    if (typeof args.button === "string") callArgs.button = this.normalizeButton(args.button);
    if (finite(args.duration_ms) !== null) {
      callArgs.duration_ms = clamp(Number(args.duration_ms), 0, 10000);
    }
    if (Array.isArray(args.modifier)) callArgs.modifier = args.modifier;
    else if (Array.isArray(args.modifiers)) callArgs.modifier = args.modifiers;
    if (typeof args.delivery_mode === "string") callArgs.delivery_mode = args.delivery_mode;
    if (prepared.scope === "desktop") callArgs.scope = "desktop";
    return this.perform("drag", "drag", callArgs, prepared.target, {
      scope: prepared.scope,
      fromX: drag.from_x,
      fromY: drag.from_y,
      toX: drag.to_x,
      toY: drag.to_y,
      button: this.normalizeButton(args.button),
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  async setValue(args: Record<string, unknown>): Promise<CuaActionResult> {
    const prepared = await this.prepareWindowAction(args, { preferPixel: false });
    if (!prepared.token) {
      throw new CuaDriverError(
        "set_value needs an element_index or element_token.",
        "element_not_found",
        "Run computer_get_app_state for this app, then pass the field's element_index.",
      );
    }
    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
      element_token: prepared.token,
      value: String(args.value ?? "").slice(0, 100000),
    };
    if (typeof args.delivery_mode === "string") callArgs.delivery_mode = args.delivery_mode;
    return this.perform("set_value", "type", callArgs, prepared.target, {
      x: prepared.point?.x,
      y: prepared.point?.y,
      text: String(args.value ?? "").slice(0, 120),
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  async moveCursor(args: Record<string, unknown>): Promise<CuaActionResult> {
    const prepared = await this.prepareWindowAction(args);
    if (!prepared.point) {
      throw new CuaDriverError("move_cursor needs x/y.", "invalid_args", "Pass window-local x,y pixels.");
    }
    const callArgs: Record<string, unknown> = {
      ...this.targetArgs(prepared.target, prepared.scope),
      x: prepared.point.x,
      y: prepared.point.y,
    };
    if (prepared.scope === "desktop") callArgs.scope = "desktop";
    return this.perform("move_cursor", "move", callArgs, prepared.target, {
      scope: prepared.scope,
      x: prepared.point.x,
      y: prepared.point.y,
      element: prepared.element ?? undefined,
      observation: prepared.observation ?? undefined,
    });
  }

  // ---------------------------------------------------------------------
  // Lifecycle / app actions
  // ---------------------------------------------------------------------

  async launchApp(args: Record<string, unknown>): Promise<CuaActionResult & { windows: CuaWindowRecord[] }> {
    const name =
      (typeof args.name === "string" && args.name) ||
      (typeof args.app === "string" && args.app) ||
      "";
    const urls = Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [];
    if (!name && urls.length === 0) {
      throw new CuaDriverError(
        "launch_app needs a name (or URLs).",
        "invalid_args",
        "Pass the app name from computer_list_apps, e.g. \"Safari\".",
      );
    }
    const callArgs: Record<string, unknown> = {};
    if (name) callArgs.name = name;
    if (typeof args.bundle_id === "string" && args.bundle_id) callArgs.bundle_id = args.bundle_id;
    if (typeof args.launch_path === "string" && args.launch_path) callArgs.launch_path = args.launch_path;
    if (urls.length > 0) callArgs.urls = urls;
    if (Array.isArray(args.additional_arguments)) {
      callArgs.additional_arguments = args.additional_arguments.map((a) => String(a));
    }
    const result = await this.call("launch_app", callArgs, {
      timeoutMs: Math.max(30000, cuaDriverTimeoutMs()),
    });
    this.emit({
      kind: "launch",
      tool: "computer_launch_app",
      ok: true,
      app: name || undefined,
      meta: { urls },
    });

    // A launch is asynchronous. Poll briefly for a real window, but never
    // turn a successful launch into a failure just because it is slow.
    let windows: CuaWindowRecord[] = [];
    const waitUntil = name ? Date.now() + 4500 : 0;
    while (name && Date.now() < waitUntil) {
      try {
        windows = await this.listWindows({ app: name || undefined, on_screen_only: true });
      } catch {
        windows = [];
      }
      if (windows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (windows.length > 0) {
      const chosen = this.chooseWindow(windows);
      if (chosen) {
        this.rememberTarget({
          pid: chosen.pid,
          windowId: chosen.window_id,
          app: chosen.app_name || name || undefined,
          title: chosen.title,
          bounds: chosen.bounds,
          scope: "window",
        });
      }
    }
    return { ...toActionResult(result), windows };
  }

  async activateWindow(args: Record<string, unknown>): Promise<CuaActionResult & { window: CuaWindowRecord | null }> {
    const target = await this.resolveTarget(args);
    if (!target) {
      throw new CuaDriverError(
        "No window to activate. Pass app, pid, or window_id.",
        "target_not_found",
        "Call computer_list_windows first.",
      );
    }
    const callArgs: Record<string, unknown> = { pid: target.pid };
    if (target.windowId) callArgs.window_id = target.windowId;
    const result = await this.call("bring_to_front", callArgs, {
      timeoutMs: Math.max(20000, cuaDriverTimeoutMs()),
    });
    this.rememberTarget(target);
    let window: CuaWindowRecord | null = null;
    try {
      const windows = await this.listWindows({ pid: target.pid });
      window =
        windows.find((w) => target.windowId && w.window_id === target.windowId) ??
        this.chooseWindow(windows);
    } catch {}
    this.emit({
      kind: "window",
      tool: "computer_activate_window",
      ok: true,
      app: target.app,
      pid: target.pid,
      windowId: target.windowId,
      windowTitle: target.title,
      meta: { activated: true },
    });
    return { ...toActionResult(result), window };
  }

  async getWindow(args: Record<string, unknown>): Promise<{
    window: CuaWindowRecord | null;
    windows: CuaWindowRecord[];
  }> {
    const target = await this.resolveTarget(args, { fallbackLast: false });
    if (!target && !args.app && !args.pid) {
      const windows = await this.listWindows({
        on_screen_only: args.on_screen_only === true,
      });
      return { window: null, windows };
    }
    const windows = await this.listWindows({
      pid: target?.pid,
      app: target?.app,
      on_screen_only: args.on_screen_only === true,
    });
    const match =
      windows.find((w) => target?.windowId && w.window_id === target.windowId) ??
      this.chooseWindow(windows);
    return { window: match, windows };
  }

  async clipboardRead(): Promise<CuaActionResult> {
    return toActionResult(await this.call("clipboard_read", { include_text: true }));
  }

  async clipboardWrite(args: Record<string, unknown>): Promise<CuaActionResult> {
    const text = String(args.text ?? "");
    if (!text) {
      throw new CuaDriverError(
        "clipboard_write needs text.",
        "invalid_args",
        "Pass the text to copy.",
      );
    }
    const result = toActionResult(await this.call("clipboard_write", { text: text.slice(0, 100000) }));
    this.emit({
      kind: "clipboard",
      tool: "computer_clipboard_write",
      ok: true,
      text: text.slice(0, 80),
      meta: { chars: text.length },
    });
    return result;
  }

  async doctor(): Promise<{ raw: string; data: Record<string, unknown> | null }> {
    return this.driver.doctor();
  }

  async capabilities(): Promise<Record<string, unknown>> {
    const [status, config, tools] = await Promise.all([
      this.driver.status().catch((error) => ({ running: false, raw: cuaErrorMessage(error) })),
      this.call("get_config", {}).catch(() => null),
      this.driver.listToolDescriptions().catch(() => []),
    ]);
    return {
      ok: true,
      driver: {
        command: this.driver.command,
        source: this.driver.source,
        daemonRunning: status.running,
      },
      session: this.session,
      platform: process.platform,
      display:
        process.env.DISPLAY || process.env.WAYLAND_DISPLAY
          ? "available"
          : "missing",
      config: config?.data ?? null,
      tools: tools.map((tool) => tool.name),
      native: {
        actions: [...CUA_ACTION_TOOLS],
        batching: "run_steps",
        screenshots: true,
        cinematicCursor: true,
      },
      readOnly: [...CUA_READ_ONLY_QUBE_TOOLS],
      qReadOnlyHint: "computer_get_app_state, computer_list_apps, computer_list_windows, computer_doctor, computer_capabilities and computer_clipboard_read never pause.",
      installHint: "https://github.com/trycua/cua",
    };
  }

  // ---------------------------------------------------------------------
  // Run sequence (legacy ocu-compatible batching)
  // ---------------------------------------------------------------------

  async runSequence(input: RunSequenceInput): Promise<string> {
    if (Array.isArray(input.steps) && !Array.isArray(input.calls)) {
      return this.runStepsDirect(input);
    }

    const validated = validateSequenceCalls(input.calls);
    if (!validated.ok) {
      throw new CuaDriverError(validated.error, "invalid_args", "Provide calls: [{tool, args}, …].");
    }
    const calls = validated.calls;

    // Default target: explicit app/window, else the first step that names a
    // target, else the last observed window.
    let defaultTarget: CuaTarget | null = null;
    try {
      if (input.app || input.window) {
        defaultTarget = await this.resolveTarget({ app: input.app, window: input.window });
      } else {
        const named = calls.find(
          (call) =>
            call.args.app !== undefined ||
            call.args.pid !== undefined ||
            call.args.window_id !== undefined ||
            call.args.window !== undefined,
        );
        if (named) {
          defaultTarget = await this.resolveTarget({
            app: named.args.app,
            pid: named.args.pid,
            window_id: named.args.window_id,
            window: named.args.window,
          });
        } else {
          defaultTarget = this.lastTarget;
        }
      }
    } catch (error) {
      // Named observations may still resolve themselves below; only fail if
      // a named action needs the target.
      defaultTarget = null;
    }

    const batchId = `seq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const observeAfter = input.observe !== false;
    const wantPostObservation = observeAfter && calls.some((call) => !isLegacyObservationTool(call.tool));
    const delayMs =
      finite(input.sleep) !== null
        ? clamp(Math.round(Number(input.sleep) * 1000), 0, 2000)
        : 0;
    const results: Array<{ tool: string; ok: boolean; summary?: string; error?: string }> = [];
    let observation: CuaObservation | null = null;
    // Observations taken by the sequence itself are published once, right
    // before the actions they ground, so the UI never animates against a
    // screenshot it has not received yet.
    let pendingSteps: CuaSequenceStep[] = [];
    let pendingPlans: StepPlan[] = [];
    let actionCount = 0;
    let failure: unknown = null;

    const publishObservation = (obs: CuaObservation): void => {
      this.storeFrame(obs);
      this.emit({
        kind: "observe",
        tool: obs.scope === "desktop" ? "computer_get_desktop_state" : "computer_get_app_state",
        ok: true,
        app: obs.app,
        pid: obs.pid,
        windowId: obs.windowId,
        windowTitle: obs.title,
        scope: obs.scope,
        frameWidth: obs.width,
        frameHeight: obs.height,
        meta: { elements: obs.elements.length, snapshotId: obs.snapshotId },
      });
    };

    const flush = async (): Promise<void> => {
      if (this.pendingObservationEvents.length > 0) {
        this.pendingObservationEvents.splice(0).forEach(publishObservation);
      }
      if (pendingSteps.length === 0) return;
      const steps = pendingSteps;
      const plans = pendingPlans;
      pendingSteps = [];
      pendingPlans = [];

      const args: Record<string, unknown> = {
        steps,
        foreground_fallback: true,
      };
      if (delayMs > 0) args.delay_ms = delayMs;
      // Window steps carry their own pid/window_id; desktop-scope steps must
      // NOT inherit one (that would translate desktop pixels into a window).

      let stepResults: Array<Record<string, unknown>> = [];
      let batchError: unknown = null;
      try {
        const result = await this.call("run_steps", args, { timeoutMs: 90000 });
        stepResults = Array.isArray(result.data?.steps)
          ? (result.data.steps as Array<Record<string, unknown>>)
          : [];
      } catch (error) {
        batchError = error;
        if (error instanceof CuaToolError) {
          const data = error.parsed.data;
          if (Array.isArray(data?.steps)) stepResults = data.steps as Array<Record<string, unknown>>;
        }
      }

      const parsedFailureIndex = (() => {
        if (!batchError) return -1;
        const failedStep = finite((batchError as CuaToolError).parsed?.data?.failed_step);
        if (failedStep !== null) return Math.max(0, Math.min(plans.length - 1, Math.round(failedStep)));
        const msg = cuaErrorMessage(batchError);
        const m = /step\s*#?\s*(\d+)/i.exec(msg);
        if (m) {
          const n = Number(m[1]);
          // CUA reports 1-based step numbers; tolerate 0-based too.
          return n >= 1 && n <= plans.length ? n - 1 : Math.max(0, Math.min(plans.length - 1, n));
        }
        return -1;
      })();

      plans.forEach((plan, index) => {
        const raw = stepResults[index];
        const rawOk =
          raw && typeof raw.ok === "boolean"
            ? raw.ok
            : raw && typeof raw.success === "boolean"
              ? raw.success
              : undefined;
        const errorText =
          raw && typeof raw.error === "string"
            ? raw.error
            : batchError
              ? parsedFailureIndex === index || parsedFailureIndex === -1
                ? cuaErrorMessage(batchError)
                : "Skipped after an earlier step failed."
              : undefined;
        const ok = rawOk ?? (!batchError && !errorText);
        results.push({
          tool: plan.tool,
          ok,
          ...(typeof raw?.summary === "string" ? { summary: raw.summary } : {}),
          ...(errorText ? { error: errorText.slice(0, 800) } : {}),
        });
        if (!ok) {
          if (batchError && parsedFailureIndex >= 0 && index > parsedFailureIndex) {
            return; // never animate actions that did not run
          }
          this.emit({
            kind: plan.kind,
            tool: this.qubeToolFor(plan.tool),
            ok: false,
            app: plan.target?.app,
            pid: plan.target?.pid,
            windowId: plan.target?.windowId,
            windowTitle: plan.target?.title,
            scope: plan.scope,
            x: plan.x,
            y: plan.y,
            fromX: plan.fromX,
            fromY: plan.fromY,
            toX: plan.toX,
            toY: plan.toY,
            frameWidth: plan.observation?.width,
            frameHeight: plan.observation?.height,
            text: plan.text,
            key: plan.key,
            keys: plan.keys,
            direction: plan.direction,
            amount: plan.amount,
            by: plan.by,
            button: plan.button,
            batchId,
            stepIndex: index,
            error: errorText?.slice(0, 600),
          });
          return;
        }
        this.emit({
          kind: plan.kind,
          tool: this.qubeToolFor(plan.tool),
          ok: true,
          app: plan.target?.app,
          pid: plan.target?.pid,
          windowId: plan.target?.windowId,
          windowTitle: plan.target?.title,
          scope: plan.scope,
          x: plan.x,
          y: plan.y,
          fromX: plan.fromX,
          fromY: plan.fromY,
          toX: plan.toX,
          toY: plan.toY,
          frameWidth: plan.observation?.width,
          frameHeight: plan.observation?.height,
          text: plan.text,
          key: plan.key,
          keys: plan.keys,
          direction: plan.direction,
          amount: plan.amount,
          by: plan.by,
          button: plan.button,
          batchId,
          stepIndex: index,
        });
      });

      if (!batchError) {
        const failedIndex = stepResults.findIndex(
          (step) => step && (step.ok === false || step.success === false),
        );
        if (failedIndex >= 0) {
          const message =
            typeof stepResults[failedIndex]?.error === "string"
              ? String(stepResults[failedIndex].error)
              : `CUA step ${failedIndex + 1} failed.`;
          throw new CuaDriverError(
            message,
            "action_failed",
            "Re-read the app state, verify the target, then retry once with a different method.",
          );
        }
      }
      if (batchError) throw batchError;
    };

    this.deferObservationEvents++;
    try {
      for (const call of calls) {
        const tool = String(call.tool);
        const args = call.args;

        if (isLegacyObservationTool(tool)) {
          await flush();
          if (tool === "list_apps") {
            const apps = await this.listApps();
            results.push({ tool, ok: true, summary: `${apps.length} apps` });
            continue;
          }
          if (tool === "list_windows") {
            const target = await this.resolveTarget(args, { fallbackLast: false }).catch(() => null);
            const windows = await this.listWindows({
              pid: target?.pid ?? positiveInt(args.pid) ?? undefined,
              app: target?.app ?? (typeof args.app === "string" ? args.app : undefined),
              on_screen_only: args.on_screen_only === true,
            });
            results.push({ tool, ok: true, summary: `${windows.length} windows` });
            continue;
          }
          if (tool === "get_window") {
            const got = await this.getWindow(args);
            results.push({
              tool,
              ok: true,
              summary: got.window
                ? `${got.window.app_name ?? "window"} (${got.window.pid}/${got.window.window_id})`
                : `${got.windows.length} windows`,
            });
            continue;
          }
          if (tool === "get_desktop_state") {
            observation = await this.observeDesktop({});
            results.push({ tool, ok: true, summary: "desktop screenshot" });
            continue;
          }
          observation = await this.observeWindow({
            pid: targetPid(args),
            window_id: targetWindow(args),
            app: typeof args.app === "string" ? args.app : undefined,
            window: typeof args.window === "string" ? args.window : undefined,
            max_elements: finite(args.max_elements) ?? undefined,
            max_depth: finite(args.max_tree_depth ?? args.max_depth) ?? undefined,
            query: typeof args.query === "string" ? args.query : undefined,
          });
          if (observation.pid && observation.windowId) {
            defaultTarget = {
              pid: observation.pid,
              windowId: observation.windowId,
              app: observation.app,
              title: observation.title,
              bounds: observation.windowBounds,
              scope: "window",
            };
          }
          results.push({
            tool,
            ok: true,
            summary: `${observation.elements.length} elements${observation.snapshotId ? ` · ${observation.snapshotId}` : ""}`,
          });
          continue;
        }

        if (isLegacyImmediateTool(tool)) {
          await flush();
          if (tool === "launch_app") {
            const launched = await this.launchApp(args);
            results.push({
              tool,
              ok: true,
              summary: launched.windows.length
                ? `${launched.windows.length} window(s)`
                : "launched",
            });
            if (launched.windows.length > 0) {
              const chosen = this.chooseWindow(launched.windows);
              if (chosen) {
                defaultTarget = {
                  pid: chosen.pid,
                  windowId: chosen.window_id,
                  app: chosen.app_name,
                  title: chosen.title,
                  bounds: chosen.bounds,
                  scope: "window",
                };
              }
            }
          } else {
            const activated = await this.activateWindow(args);
            results.push({
              tool,
              ok: true,
              summary: activated.window
                ? `${activated.window.app_name ?? "window"} activated`
                : "activated",
            });
            if (activated.window) {
              defaultTarget = {
                pid: activated.window.pid,
                windowId: activated.window.window_id,
                app: activated.window.app_name,
                title: activated.window.title,
                bounds: activated.window.bounds,
                scope: "window",
              };
            }
          }
          continue;
        }

        const actionTool = legacyActionTool(tool);
        if (!actionTool) {
          throw new CuaDriverError(
            `Unsupported sequence tool "${tool}".`,
            "invalid_args",
            "Use an observed action from computer_get_app_state.",
          );
        }

        const desktopStep =
          args.scope === "desktop" || args.coordinate_frame === "desktop";
        let target = desktopStep ? null : defaultTarget;
        if (
          !desktopStep &&
          (args.app !== undefined ||
            args.pid !== undefined ||
            args.window_id !== undefined ||
            args.window !== undefined)
        ) {
          target = await this.resolveTarget(args);
          if (target) defaultTarget = target;
        }
        if (!target && !desktopStep) {
          throw new CuaDriverError(
            "No target window for the sequence action.",
            "target_not_found",
            "Start the sequence with get_app_state for the app, or pass app in the sequence call.",
          );
        }

        const windowTarget = desktopStep ? null : (target as CuaTarget);
        let resolvedToken: string | null = null;
        let element: CuaElement | null = null;
        let observationForStep = this.observationFor(windowTarget);

        if (typeof args.element_token === "string" && args.element_token) {
          resolvedToken = args.element_token;
          const found = this.elementByToken(resolvedToken);
          element = found.element;
          if (found.observation) observationForStep = found.observation;
        } else {
          const index = normalizeElementIndex(
            args.element_index ?? args.index ?? args.row ?? args.element,
          );
          if (index !== null) {
            let fromObs = this.elementFromObservation(observationForStep, index);
            if (!fromObs) {
              if (!windowTarget) {
                throw new CuaDriverError(
                  "No target window for the sequence action.",
                  "target_not_found",
                  "Start the sequence with get_app_state for the app, or pass app in the sequence call.",
                );
              }
              await flush();
              observationForStep = await this.observeWindow({
                pid: windowTarget.pid,
                window_id: windowTarget.windowId,
                app: windowTarget.app,
                window: windowTarget.title,
              });
              fromObs = this.elementFromObservation(observationForStep, index);
              results.push({
                tool: "get_app_state",
                ok: true,
                summary: `auto-observe ${index}`,
              });
            }
            if (!fromObs) {
              throw new CuaDriverError(
                `Element [${index}] is not present in the current window state.`,
                "element_not_found",
                "Re-run get_app_state inside the sequence and use a listed element_index.",
              );
            }
            element = fromObs;
            resolvedToken =
              fromObs.element_token ??
              (observationForStep?.snapshotId
                ? `${observationForStep.snapshotId}:${index}`
                : null);
            if (!resolvedToken) {
              throw new CuaDriverError(
                `Element [${index}] has no element token.`,
                "element_not_found",
                "Re-run get_app_state and retry.",
              );
            }
          }
        }

        let step: CuaSequenceStep;
        try {
          step = translateLegacyAction(tool, args, resolvedToken);
        } catch (error) {
          throw new CuaDriverError(
            cuaErrorMessage(error),
            "invalid_args",
            "Check the step args against computer_get_app_state.",
          );
        }

        const stepScope: CuaScope =
          step.args.scope === "desktop" || step.args.coordinate_frame === "desktop"
            ? "desktop"
            : "window";
        // Window steps carry their own target. Desktop steps must not inherit
        // a pid/window or CUA would translate their coordinates into it.
        if (stepScope === "desktop") {
          delete (step.args as Record<string, unknown>).pid;
          delete (step.args as Record<string, unknown>).window_id;
          delete (step.args as Record<string, unknown>).app;
        } else if (windowTarget) {
          step.args = {
            pid: windowTarget.pid,
            ...(windowTarget.windowId ? { window_id: windowTarget.windowId } : {}),
            ...step.args,
          };
        }
        if (step.tool !== "click" && step.tool !== "double_click" && step.tool !== "right_click") {
          delete (step.args as Record<string, unknown>).count;
        }
        const observationForScope =
          stepScope === "desktop"
            ? this.observations.find((obs) => obs.scope === "desktop") ?? null
            : observationForStep;

        const point =
          finite(step.args.x) !== null && finite(step.args.y) !== null
            ? { x: Number(step.args.x), y: Number(step.args.y) }
            : element
              ? this.elementCenter(element, observationForStep)
              : null;
        const plan: StepPlan = {
          tool: step.tool,
          kind:
            step.tool === "right_click"
              ? "right_click"
              : step.tool === "double_click" ||
                  (step.tool === "click" && Number(step.args.count) > 1)
                ? "double_click"
                : step.tool === "scroll"
                  ? "scroll"
                  : step.tool === "drag"
                    ? "drag"
                    : step.tool === "type_text" || step.tool === "set_value"
                      ? "type"
                      : step.tool === "press_key" || step.tool === "hotkey"
                        ? "key"
                        : "click",
          target,
          scope: stepScope,
          x: point?.x,
          y: point?.y,
          fromX: finite(step.args.from_x) ?? undefined,
          fromY: finite(step.args.from_y) ?? undefined,
          toX: finite(step.args.to_x) ?? undefined,
          toY: finite(step.args.to_y) ?? undefined,
          text:
            typeof step.args.text === "string"
              ? step.args.text.slice(0, 160)
              : typeof step.args.value === "string"
                ? step.args.value.slice(0, 120)
                : undefined,
          key: typeof step.args.key === "string" ? step.args.key : undefined,
          keys: Array.isArray(step.args.keys) ? step.args.keys.map((k) => String(k)) : undefined,
          direction:
            step.args.direction === "up" ||
            step.args.direction === "down" ||
            step.args.direction === "left" ||
            step.args.direction === "right"
              ? step.args.direction
              : undefined,
          amount: finite(step.args.amount) ?? undefined,
          by: step.args.by === "page" ? "page" : step.args.by === "line" ? "line" : undefined,
          button: this.normalizeButton(step.args.button),
          element: element ?? undefined,
          observation: observationForScope ?? undefined,
        };
        pendingSteps.push(step);
        pendingPlans.push(plan);
        actionCount++;
        if (pendingSteps.length >= 64) await flush();
      }

      await flush();
    } catch (error) {
      failure = error;
    } finally {
      this.deferObservationEvents = Math.max(0, this.deferObservationEvents - 1);
      if (this.pendingObservationEvents.length > 0) {
        this.pendingObservationEvents.splice(0).forEach(publishObservation);
      }
    }

    if (actionCount > 0 && wantPostObservation) {
      try {
        if (defaultTarget) {
          observation = await this.observeWindow({
            pid: defaultTarget.pid,
            window_id: defaultTarget.windowId,
            app: defaultTarget.app,
            window: defaultTarget.title,
          });
        }
      } catch (error) {
        // The action already happened; report the observation failure but
        // keep the action results.
        results.push({ tool: "get_app_state", ok: false, error: cuaErrorMessage(error) });
      }
    }

    if (failure) {
      const info =
        failure instanceof CuaToolError
          ? translateCuaFailure(cuaErrorMessage(failure), failure.parsed.data)
          : failure instanceof CuaDriverError
            ? { code: failure.code, message: failure.message, hint: failure.hint }
            : translateCuaFailure(cuaErrorMessage(failure), null);
      return JSON.stringify({
        ok: false,
        session: this.session,
        error: info.message.slice(0, 1500),
        code: info.code,
        hint: info.hint,
        steps: results,
        ...(observation
          ? { observation: this.renderObservation(observation).slice(0, 12000) }
          : {}),
      });
    }

    const anyActions = results.some((r) =>
      [
        "click",
        "double_click",
        "right_click",
        "scroll",
        "drag",
        "type_text",
        "press_key",
        "hotkey",
        "set_value",
        "launch_app",
        "activate_window",
      ].includes(r.tool),
    );
    if (!anyActions) {
      const text = observation?.text || "";
      if (text) return text.slice(0, MAX_OBSERVATION_TEXT);
      return JSON.stringify({ ok: true, session: this.session, steps: results });
    }
    return JSON.stringify({
      ok: true,
      session: this.session,
      steps: results,
      ...(observation
        ? {
            observation: this.renderObservation(observation).slice(0, 12000),
            frame: observation.width
              ? { width: observation.width, height: observation.height, scope: observation.scope }
              : undefined,
          }
        : {}),
    });
  }

  private async runStepsDirect(input: RunSequenceInput): Promise<string> {
    const raw = Array.isArray(input.steps) ? input.steps : [];
    if (raw.length === 0) {
      throw new CuaDriverError("steps must be a non-empty array.", "invalid_args", "Provide CUA run_steps steps.");
    }
    if (raw.length > 64) {
      throw new CuaDriverError("At most 64 steps are allowed.", "invalid_args", "Split the batch.");
    }
    const steps = raw.map((entry) => {
      const rec = asRecord(entry);
      if (!rec) throw new CuaDriverError("Each step must be an object.", "invalid_args", "Use {tool,args}.");
      return rec as CuaSequenceStep;
    });
    const target = input.app || input.window
      ? await this.resolveTarget({ app: input.app, window: input.window })
      : this.lastTarget;
    const args: Record<string, unknown> = { steps, foreground_fallback: true };
    if (target) {
      args.pid = target.pid;
      if (target.windowId) args.window_id = target.windowId;
    }
    if (finite(input.sleep) !== null) args.delay_ms = clamp(Math.round(Number(input.sleep) * 1000), 0, 2000);
    if (input.observe !== false) {
      args.observe = {
        include_screenshot: true,
        tree_format: "both",
        max_elements: MAX_ELEMENTS,
        since: null,
      };
    }
    const result = await this.call("run_steps", args, { timeoutMs: 90000 });
    const observationData = asRecord(result.data?.observe) ?? asRecord(result.data?.observation);
    const text =
      typeof observationData?.tree_markdown === "string"
        ? observationData.tree_markdown
        : result.text;
    return JSON.stringify({
      ok: true,
      session: this.session,
      steps: Array.isArray(result.data?.steps) ? result.data.steps : [],
      ...(text ? { observation: text.slice(0, 12000) } : {}),
    });
  }

  private qubeToolFor(cuaTool: string): string {
    switch (cuaTool) {
      case "click":
        return "computer_click";
      case "double_click":
        return "computer_click";
      case "right_click":
        return "computer_secondary_action";
      case "scroll":
        return "computer_scroll";
      case "drag":
        return "computer_drag";
      case "type_text":
        return "computer_type_text";
      case "press_key":
      case "hotkey":
        return "computer_press_key";
      case "set_value":
        return "computer_set_value";
      default:
        return `computer_${cuaTool}`;
    }
  }

  /** Latest cached tree text for a target (used by click verification). */
  cachedObservationText(input: { pid?: unknown; window_id?: unknown; app?: unknown; window?: unknown } = {}): string {
    const pid = positiveInt(input.pid);
    const windowId = finite(input.window_id);
    const app = typeof input.app === "string" ? input.app.toLowerCase() : "";
    for (const obs of this.observations) {
      if (pid !== null && obs.pid !== pid) continue;
      if (windowId !== null && obs.windowId !== undefined && obs.windowId !== Math.round(windowId)) continue;
      if (app && obs.app && !obs.app.toLowerCase().includes(app)) continue;
      if (obs.text) return obs.text;
    }
    return "";
  }

  renderObservation(observation: CuaObservation): string {
    const header = [
      observation.app ? `App: ${observation.app}` : "",
      observation.pid ? `pid ${observation.pid}` : "",
      observation.windowId ? `window ${observation.windowId}` : "",
      observation.title ? `"${observation.title}"` : "",
      observation.snapshotId ? `snapshot ${observation.snapshotId}` : "",
      observation.width && observation.height
        ? `screenshot ${observation.width}x${observation.height}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const tree = observation.text || "(no accessibility tree returned)";
    return `${header}\n\n${tree}`.slice(0, MAX_OBSERVATION_TEXT);
  }

  renderWindows(windows: CuaWindowRecord[]): string {
    if (windows.length === 0) return "No windows found.";
    return windows
      .map(
        (w) =>
          `- ${w.app_name ?? "app"} — pid ${w.pid}, window ${w.window_id}${w.title ? ` — "${w.title}"` : ""}${w.is_on_screen === false ? " (off-screen)" : ""}${w.minimized ? " (minimized)" : ""}`,
      )
      .join("\n");
  }

  renderApps(apps: Record<string, unknown>[]): string {
    if (apps.length === 0) return "No applications found.";
    return apps
      .map((app) => {
        const windows = Array.isArray(app.windows) ? app.windows.length : 0;
        return `- ${app.name ?? "app"} — pid ${app.pid ?? "?"}${windows ? ` (${windows} windows)` : ""}${app.active ? " (active)" : ""}`;
      })
      .join("\n");
  }

}

function targetPid(args: Record<string, unknown>): number | undefined {
  const n = positiveInt(args.pid);
  return n ?? undefined;
}

function targetWindow(args: Record<string, unknown>): number | undefined {
  const n = finite(args.window_id);
  return n !== null ? Math.round(n) : undefined;
}

export type { LegacySequenceCall };

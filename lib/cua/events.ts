/**
 * Server-side Computer Use event + frame hub.
 *
 * CUA Driver actions are mirrored to the UI through this small in-memory
 * pub/sub store. It is intentionally not a fake action stream: events are
 * published only after the real CUA call returns, carrying the exact
 * screenshot-pixel coordinates the driver acted on.
 *
 * The store lives on globalThis because Next.js can evaluate route handlers
 * and tool modules in separate bundles during development.
 */

import type {
  CuaActionEvent,
  CuaEventEnvelope,
  CuaFrame,
  CuaFrameMeta,
} from "./types";

const MAX_ACTIONS = 800;
const MAX_FRAMES = 4;
const MAX_FRAME_BASE64 = 12 * 1024 * 1024; // ~9 MB decoded

export type CuaActionInput = Omit<CuaActionEvent, "id" | "at"> & { at?: number };
export type CuaFrameInput = Omit<CuaFrame, "version" | "at"> & { at?: number };

export class CuaEventHub {
  private nextId = 1;
  private events: CuaActionEvent[] = [];
  private listeners = new Set<(event: CuaEventEnvelope) => void>();
  private activeThread = "";

  publishAction(input: CuaActionInput): CuaActionEvent {
    const event: CuaActionEvent = {
      ...input,
      id: this.nextId++,
      at: input.at ?? Date.now(),
      threadId: input.threadId || "default",
    };
    this.activeThread = event.threadId;
    this.events.push(event);
    if (this.events.length > MAX_ACTIONS) {
      this.events.splice(0, this.events.length - MAX_ACTIONS);
    }
    this.emit({ type: "action", event });
    return event;
  }

  publishFrame(frame: CuaFrameMeta): void {
    this.activeThread = frame.threadId || this.activeThread;
    this.emit({ type: "frame", frame });
  }

  subscribe(listener: (event: CuaEventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: CuaEventEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  activeThreadId(): string {
    return this.activeThread;
  }

  latest(threadId?: string): CuaActionEvent | null {
    const id = threadId || this.activeThread;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (!id || event.threadId === id) return event;
    }
    return null;
  }

  lastId(threadId?: string): number {
    const id = threadId || this.activeThread;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (!id || event.threadId === id) return event.id;
    }
    return 0;
  }

  eventsSince(threadId: string | undefined, sinceId: number): CuaActionEvent[] {
    const id = threadId || this.activeThread;
    return this.events.filter((event) => event.id > sinceId && (!id || event.threadId === id));
  }

  /** Recent actions, used for reconnect/replay snapshots. */
  recent(threadId?: string, limit = 12): CuaActionEvent[] {
    const id = threadId || this.activeThread;
    return this.events.filter((event) => !id || event.threadId === id).slice(-Math.max(1, limit));
  }

  reset(): void {
    this.nextId = 1;
    this.events = [];
    this.activeThread = "";
    this.listeners.clear();
  }
}

export class CuaFrameStore {
  private frames = new Map<string, CuaFrame>();
  private versions = new Map<string, number>();
  private order: string[] = [];

  constructor(private hub: CuaEventHub) {}

  put(input: CuaFrameInput): CuaFrameMeta | null {
    const threadId = input.threadId || "default";
    if (!input.base64 || input.base64.length > MAX_FRAME_BASE64 || !input.width || !input.height) {
      return null;
    }
    const version = (this.versions.get(threadId) ?? 0) + 1;
    this.versions.set(threadId, version);
    const frame: CuaFrame = {
      ...input,
      threadId,
      version,
      at: input.at ?? Date.now(),
    };
    this.frames.set(threadId, frame);
    this.order = [...this.order.filter((id) => id !== threadId), threadId];
    while (this.order.length > MAX_FRAMES) {
      const removed = this.order.shift();
      if (removed) {
        this.frames.delete(removed);
        this.versions.delete(removed);
      }
    }
    const meta: CuaFrameMeta = {
      threadId: frame.threadId,
      version: frame.version,
      scope: frame.scope,
      at: frame.at,
      width: frame.width,
      height: frame.height,
      mime: frame.mime,
      app: frame.app,
      pid: frame.pid,
      windowId: frame.windowId,
      windowTitle: frame.windowTitle,
    };
    this.hub.publishFrame(meta);
    return meta;
  }

  get(threadId?: string): CuaFrame | null {
    const id = threadId || this.hub.activeThreadId();
    return (id ? this.frames.get(id) : null) ?? null;
  }

  meta(threadId?: string): CuaFrameMeta | null {
    const frame = this.get(threadId);
    if (!frame) return null;
    return {
      threadId: frame.threadId,
      version: frame.version,
      scope: frame.scope,
      at: frame.at,
      width: frame.width,
      height: frame.height,
      mime: frame.mime,
      app: frame.app,
      pid: frame.pid,
      windowId: frame.windowId,
      windowTitle: frame.windowTitle,
    };
  }

  reset(): void {
    this.frames.clear();
    this.versions.clear();
    this.order = [];
  }
}

type CuaGlobal = {
  hub?: CuaEventHub;
  frames?: CuaFrameStore;
};

const GLOBAL_KEY = Symbol.for("qube.cua.runtime.v1");
const globalStore = globalThis as unknown as Record<symbol, CuaGlobal>;
const state: CuaGlobal = (globalStore[GLOBAL_KEY] ??= {});
export const cuaEventHub: CuaEventHub = (state.hub ??= new CuaEventHub());
export const cuaFrameStore: CuaFrameStore = (state.frames ??= new CuaFrameStore(cuaEventHub));

export type CuaSnapshot = {
  threadId: string;
  lastEventId: number;
  latest: CuaActionEvent | null;
  recent: CuaActionEvent[];
  frame: CuaFrameMeta | null;
};

export function cuaSnapshot(threadId?: string): CuaSnapshot {
  const id = threadId || cuaEventHub.activeThreadId();
  return {
    threadId: id,
    lastEventId: cuaEventHub.lastId(id),
    latest: cuaEventHub.latest(id),
    recent: cuaEventHub.recent(id, 8),
    frame: cuaFrameStore.meta(id),
  };
}

/** Hard reset: drop all in-memory mirror state. */
export function resetCuaRuntimeForHardReset(): void {
  cuaEventHub.reset();
  cuaFrameStore.reset();
}

/**
 * Timeline planning for the Computer panel.
 *
 * The panel does NOT invent actions. It takes one real CuaActionEvent (which
 * carries the exact screenshot-pixel coordinates the driver acted on) and
 * turns it into a deterministic cursor animation. Events without grounded
 * coordinates return null, so unknown actions never produce a fake click.
 */

import type { CuaActionEvent, CuaActionKind } from "@/lib/cua/types";
import { easeInOutCubic, easeOutCubic, type Easing } from "./easing";

export type Point = { x: number; y: number };

export type CursorSegment = {
  from: Point;
  to: Point;
  duration: number;
  ease: Easing;
  /** Pointer is held down during this segment (drag). */
  pressed?: boolean;
};

export type CursorImpact = {
  kind: "click" | "double_click" | "right_click" | "drag" | "scroll" | "key" | "type";
  at: number;
  x?: number;
  y?: number;
  label?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
};

export type CursorAnimation = {
  id: number;
  kind: CuaActionKind;
  segments: CursorSegment[];
  totalDuration: number;
  moveDuration: number;
  target: Point | null;
  impacts: CursorImpact[];
  pressStart: number;
  pressEnd: number;
  event: CuaActionEvent;
};

export type PlanOptions = {
  /** 1 = normal; >1 shortens movement when the queue is backed up. */
  speed?: number;
};

const MIN_TRAVEL = 110;
const MAX_TRAVEL = 430;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointOf(x: unknown, y: unknown): Point | null {
  const px = finite(x);
  const py = finite(y);
  return px !== null && py !== null ? { x: px, y: py } : null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Human-ish Fitts-like duration: short hops stay quick, long cross-window
 * travels get a visible but bounded swoop. Fast enough not to slow the agent.
 */
export function travelDuration(from: Point | null, to: Point, speed = 1): number {
  if (!from) return 0;
  const d = distance(from, to);
  if (d < 0.75) return 0;
  const raw = MIN_TRAVEL + 185 * Math.log2(1 + d / 80);
  const adjusted = Math.min(MAX_TRAVEL, Math.max(MIN_TRAVEL, raw)) / Math.max(0.5, speed);
  return Math.round(adjusted);
}

function impactFor(event: CuaActionEvent, at: number, target: Point | null): CursorImpact[] {
  switch (event.kind) {
    case "click":
      return [{ kind: "click", at, x: target?.x, y: target?.y }];
    case "double_click":
      return [
        { kind: "double_click", at, x: target?.x, y: target?.y },
        { kind: "click", at: at + 95, x: target?.x, y: target?.y },
      ];
    case "right_click":
      return [{ kind: "right_click", at, x: target?.x, y: target?.y }];
    case "scroll":
      return [
        {
          kind: "scroll",
          at,
          x: target?.x,
          y: target?.y,
          direction: event.direction,
          amount: event.amount,
        },
      ];
    case "drag":
      return [{ kind: "drag", at, x: target?.x, y: target?.y }];
    case "key":
      return [
        {
          kind: "key",
          at,
          x: target?.x,
          y: target?.y,
          label: event.keys?.length ? event.keys.join("+") : event.key,
        },
      ];
    case "type":
      return [
        {
          kind: "type",
          at,
          x: target?.x,
          y: target?.y,
          label: event.text ? `“${event.text.slice(0, 24)}”` : "typing",
        },
      ];
    default:
      return [];
  }
}

/**
 * Plan one event. Returns null for observations/lifecycle events, failures,
 * and any action that has no grounded coordinates.
 */
export function planActionAnimation(
  event: CuaActionEvent,
  current: Point | null,
  opts: PlanOptions = {},
): CursorAnimation | null {
  if (!event.ok) return null;
  const speed = Math.max(0.5, opts.speed ?? 1);
  const target = pointOf(event.x, event.y);

  if (event.kind === "drag") {
    const from = pointOf(event.fromX, event.fromY);
    const to = pointOf(event.toX, event.toY);
    if (!from || !to) return null;
    const approach = current ? travelDuration(current, from, speed) : 0;
    const dragDuration = Math.round(Math.min(900, Math.max(180, event.durationMs ?? 520)) / speed);
    const segments: CursorSegment[] = [];
    if (approach > 0) segments.push({ from: current!, to: from, duration: approach, ease: easeOutCubic });
    segments.push({ from, to, duration: dragDuration, ease: easeInOutCubic, pressed: true });
    const moveDuration = approach + dragDuration;
    const total = moveDuration + 110;
    return {
      id: event.id,
      kind: event.kind,
      segments,
      totalDuration: total,
      moveDuration,
      target: to,
      impacts: [
        { kind: "drag", at: moveDuration, x: to.x, y: to.y },
      ],
      pressStart: approach,
      pressEnd: moveDuration,
      event,
    };
  }

  if (event.kind === "click" || event.kind === "double_click" || event.kind === "right_click") {
    if (!target) return null;
    const move = travelDuration(current, target, speed);
    const hold =
      event.kind === "double_click" ? 230 : event.kind === "right_click" ? 190 : 140;
    const total = move + hold;
    return {
      id: event.id,
      kind: event.kind,
      segments:
        move > 0 && current
          ? [{ from: current, to: target, duration: move, ease: easeOutCubic }]
          : [],
      totalDuration: total,
      moveDuration: move,
      target,
      impacts: impactFor(event, move, target),
      pressStart: move,
      pressEnd: move + 90,
      event,
    };
  }

  if (event.kind === "scroll") {
    if (!target) return null;
    const move = travelDuration(current, target, speed);
    const total = move + 300;
    return {
      id: event.id,
      kind: event.kind,
      segments:
        move > 0 && current
          ? [{ from: current, to: target, duration: move, ease: easeOutCubic }]
          : [],
      totalDuration: total,
      moveDuration: move,
      target,
      impacts: impactFor(event, move, target),
      pressStart: move,
      pressEnd: move + 40,
      event,
    };
  }

  if (event.kind === "key" || event.kind === "type") {
    // A keyboard action may be aimed at a field (x/y) or at the current
    // focus. With no coordinates we pulse at the real cursor position but
    // never move it somewhere invented.
    const destination = target ?? current;
    if (!destination) return null;
    const move = target ? travelDuration(current, target, speed) : 0;
    const total = move + 160;
    return {
      id: event.id,
      kind: event.kind,
      segments:
        move > 0 && current && target
          ? [{ from: current, to: target, duration: move, ease: easeOutCubic }]
          : [],
      totalDuration: total,
      moveDuration: move,
      target: destination,
      impacts: impactFor(event, move, destination),
      pressStart: move,
      pressEnd: move + 70,
      event,
    };
  }

  return null;
}

/** Position at `elapsed` ms. Always lands exactly on the final point. */
export function sampleCursor(animation: CursorAnimation, elapsed: number): Point | null {
  const total = Math.max(0, animation.totalDuration);
  if (elapsed >= total) {
    if (animation.target) return { ...animation.target };
    const last = animation.segments[animation.segments.length - 1];
    return last ? { ...last.to } : null;
  }
  if (animation.segments.length === 0) return animation.target ? { ...animation.target } : null;
  let t = Math.max(0, elapsed);
  for (const segment of animation.segments) {
    if (t <= segment.duration || segment === animation.segments[animation.segments.length - 1]) {
      const local = segment.duration <= 0 ? 1 : Math.min(1, t / segment.duration);
      const eased = segment.ease(local);
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * eased,
        y: segment.from.y + (segment.to.y - segment.from.y) * eased,
      };
    }
    t -= segment.duration;
  }
  const last = animation.segments[animation.segments.length - 1];
  return last ? { ...last.to } : null;
}

export function isPressed(animation: CursorAnimation, elapsed: number): boolean {
  return elapsed >= animation.pressStart && elapsed <= animation.pressEnd;
}

/** Fired impacts at or before `elapsed` (the UI de-dupes by id). */
export function impactsAt(animation: CursorAnimation, elapsed: number): CursorImpact[] {
  return animation.impacts.filter((impact) => elapsed >= impact.at);
}

/** Queue pressure → speed. Keeps the mirror from lagging real actions. */
export function planSpeed(queueLength: number): number {
  if (queueLength >= 6) return 1.9;
  if (queueLength >= 3) return 1.55;
  if (queueLength >= 1) return 1.2;
  return 1;
}

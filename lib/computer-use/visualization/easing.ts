/**
 * Cursor easing curves for the Computer panel. Pure math, no DOM.
 */

export type Easing = (t: number) => number;

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Fast start, gentle arrival — the default for visible cursor travel. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** Very soft arrival, used for long movement. */
export function easeOutQuint(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 5);
}

/** Symmetric travel/arrival. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
}

/** Click press: quick in, quick out. */
export function pressCurve(t: number): number {
  const x = clamp01(t);
  return Math.sin(Math.PI * x);
}

export const EASINGS = {
  outCubic: easeOutCubic,
  outQuint: easeOutQuint,
  inOutCubic: easeInOutCubic,
  inOutSine: easeInOutSine,
} as const;

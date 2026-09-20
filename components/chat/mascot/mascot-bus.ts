"use client";

// Tiny global bus for one-shot mascot animations.
//
// Semantics: latest event wins. The rig holds at most ONE active timeline —
// when a new event arrives mid-transition the current timeline is discarded
// and the new one starts from the *current* (already damped) pose. That is
// what makes A → B → C skip B cleanly while staying smooth.

export type MascotOneshotKind =
  | "jump"
  | "nod"
  | "done"
  | "tool"
  | "browser"
  | "spin"
  | "giggle"
  | "drop";

export const MASCOT_EVENT = "qube-mascot";

export function emitMascot(kind: MascotOneshotKind) {
  try {
    window.dispatchEvent(new CustomEvent(MASCOT_EVENT, { detail: { kind } }));
  } catch {}
}

export function subscribeMascot(fn: (kind: MascotOneshotKind) => void): () => void {
  const handler = (e: Event) => {
    try {
      const kind = (e as CustomEvent).detail?.kind as MascotOneshotKind;
      if (kind) fn(kind);
    } catch {}
  };
  window.addEventListener(MASCOT_EVENT, handler as EventListener);
  return () => window.removeEventListener(MASCOT_EVENT, handler as EventListener);
}

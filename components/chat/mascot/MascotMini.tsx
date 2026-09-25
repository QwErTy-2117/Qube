"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { useAuiState } from "@assistant-ui/react";
import logoPng from "@/public/logo.png";
import { MASCOT, buildBodyGeometry, buildEyeGeometry } from "./mascot-geometry";
import { MASCOT_EVENT, type MascotOneshotKind } from "./mascot-bus";

export type MascotMode = "idle" | "working" | "tool" | "browser";

// ---------------------------------------------------------------------------
// Pose rig. All channels are damped toward their target every frame, so any
// interruption (A → B → C) blends from the *current* pose — B is skipped,
// motion never snaps.
// ---------------------------------------------------------------------------

type Pose = {
  y: number;
  x: number;
  rx: number;
  ry: number;
  rz: number;
  squash: number;
  blink: number;
  lookX: number;
  lookY: number;
  wide: number;
};

const IDLE_POSE: Pose = {
  y: 0,
  x: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  squash: 0,
  blink: 0,
  lookX: 0,
  lookY: 0,
  wide: 0,
};

const ONE_SHOT_DUR: Record<MascotOneshotKind, number> = {
  jump: 0.7,
  nod: 0.8,
  done: 1.0,
  tool: 1.1,
  browser: 1.0,
  spin: 0.75,
  giggle: 0.6,
  drop: 0.9,
};

// Gaze staging: below EYE_ONLY_R only the pupils travel and the body stays
// put; past FULL_BODY_R the whole body turns and hops slightly to get there.
// The mascot stands on an invisible tilted plane (PLANE_*): y never drops
// below the pavement, hops slide along the tilt instead of going straight up.
const EYE_ONLY_R = 0.3;
const FULL_BODY_R = 0.6;
const PLANE_RX = 0.045;
const PLANE_RZ = -0.055;
const HOP_H = 0.07;
const HOP_DUR = 0.35;

function sstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function easeInOut(p: number) {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

// Sample the procedural timeline for a one-shot at progress p ∈ [0,1].
// Returns offsets added on top of base + cursor + mode targets.
// `seed` is re-rolled per trigger for the drop so no two falls look alike.
function sampleOneshot(
  kind: MascotOneshotKind,
  p: number,
  seed?: { drift: number; tilt: number },
): Partial<Pose> {
  const s = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  switch (kind) {
    case "jump": {
      // Parabola hop + stretch on rise, squash on landing, happy squint.
      // Face tips up at the peak — eyes look skyward with joy.
      const y = 4 * 0.52 * p * (1 - p);
      const squash =
        p < 0.45 ? 0.16 * s : -0.22 * Math.sin(Math.PI * Math.min(1, (p - 0.45) / 0.55));
      return {
        y,
        squash,
        rx: -0.16 * s,
        rz: Math.sin(p * Math.PI * 2) * 0.14 * (1 - p),
        blink: s * 0.85,
        lookY: 0.045 * s,
      };
    }
    case "nod": {
      // Two affirmative nods, gaze settles to center ("look at you").
      return {
        rx: Math.sin(p * Math.PI * 2 * 1.25) * 0.3 * (1 - p * 0.25),
        y: -0.05 * s,
        lookX: 0,
        lookY: 0,
        blink: 0.25 * s,
      };
    }
    case "done": {
      // Response finished: small happy hop + nod, eyes find the viewer.
      return {
        y: 0.2 * s,
        rx: Math.sin(p * Math.PI * 2) * 0.2 * (1 - p * 0.2),
        squash: 0.1 * s,
        blink: 0.7 * s,
        lookX: 0,
        lookY: 0.01 * s,
      };
    }
    case "tool": {
      // Focused lean + squint + side-to-side scan.
      return {
        rz: 0.12 * s,
        rx: 0.08 * s,
        blink: 0.4 * s,
        lookX: Math.sin(p * Math.PI * 3) * 0.05,
        y: 0.04 * Math.sin(p * Math.PI * 2),
      };
    }
    case "browser": {
      // Excited peek to the side, eyes wide.
      return {
        ry: 0.55 * s,
        lookX: 0.1 * s,
        wide: s,
        y: 0.08 * Math.sin(p * Math.PI * 2),
        blink: 0,
      };
    }
    case "spin": {
      // Full 360° turn with a hop — the "wheee" trick.
      return {
        ry: Math.PI * 2 * easeInOut(Math.min(1, Math.max(0, p))),
        y: 0.3 * s,
        squash: 0.12 * s,
        blink: 0.5 * s,
      };
    }
    case "giggle": {
      // Rapid happy shiver when tickled / hovered.
      return {
        rz: Math.sin(p * Math.PI * 4) * 0.12 * (1 - p),
        y: Math.abs(Math.sin(p * Math.PI * 3)) * 0.12,
        squash: Math.sin(p * Math.PI * 3) * 0.1,
        blink: 0.9 * s,
        lookY: 0.03 * s,
      };
    }
    case "drop": {
      // Cartoon sky-fall: accelerating descent with a sideways slide and
      // flailing lean, splat-squash touchdown, double bounce. Faster than
      // before — the whole gag is under a second.
      const FALL = 0.5;
      const drift = seed?.drift ?? 0;
      const tilt = seed?.tilt ?? 0.2;
      if (p < FALL) {
        const q = p / FALL;
        return {
          y: 2.4 * (1 - q * q),
          x: drift * q * q,
          rz: tilt * q + Math.sin(p * Math.PI * 4) * 0.07,
          squash: 0.16 * q,
          wide: 1,
          lookY: 0.05 * q,
        };
      }
      const q = (p - FALL) / (1 - FALL);
      return {
        y:
          0.16 * Math.sin(Math.PI * q) * (1 - q * 0.4) +
          0.05 * Math.sin(2 * Math.PI * q) * (1 - q),
        x: drift * (1 - q),
        rz: tilt * (1 - q),
        squash: -0.32 * Math.cos((q * Math.PI) / 2),
        wide: 1 - q,
        blink: 0.7 * Math.sin(Math.PI * Math.min(1, q * 1.3)),
      };
    }
  }
}

function MascotModel({
  modeRef,
  cursorRef,
  listeningRef,
  responseRef,
  reduceMotion,
}: {
  modeRef: React.MutableRefObject<MascotMode>;
  cursorRef: React.MutableRefObject<{ x: number; y: number; d: number }>;
  listeningRef: React.MutableRefObject<boolean>;
  responseRef: React.MutableRefObject<{ x: number; y: number }>;
  reduceMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const leftEye = useRef<THREE.Mesh>(null);
  const rightEye = useRef<THREE.Mesh>(null);
  const leftGlint = useRef<THREE.Mesh>(null);
  const rightGlint = useRef<THREE.Mesh>(null);

  const bodyGeom = useMemo(() => buildBodyGeometry(), []);
  const eyeGeom = useMemo(() => buildEyeGeometry(), []);
  const glintGeom = useMemo(() => new THREE.SphereGeometry(0.026, 12, 12), []);
  useEffect(
    () => () => {
      bodyGeom.dispose();
      eyeGeom.dispose();
      glintGeom.dispose();
    },
    [bodyGeom, eyeGeom, glintGeom],
  );

  const cur = useRef<Pose>({ ...IDLE_POSE, y: reduceMotion ? 0 : 2.4 });
  const oneshot = useRef<{ kind: MascotOneshotKind; start: number } | null>(null);
  const prevKind = useRef<MascotOneshotKind | null>(null);
  // Re-rolled every fall: sideways drift + lean direction.
  const dropSeed = useRef({ drift: 0, tilt: 0.2 });
  // Hop-to-turn state: rising edge past FULL_BODY_R triggers one hop.
  const wasBeyond = useRef(false);
  const hopT = useRef(1e9);
  // Entrance drop: wall-clock 3s from the FIRST RENDERED FRAME (not mount,
  // not render-clock) — immune to slow canvas init and clock stalls. Fires
  // on its own; only skipped while another gag is literally mid-flight.
  const bornAt = useRef<number | null>(null);
  const dropSettled = useRef(false);
  const nextBlinkAt = useRef(1.5);
  // Idle saccades: occasional glance darts when the cursor is far/idle.
  const saccade = useRef({ x: 0, y: 0, until: 0, next: 3 });

  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const kind = (e as CustomEvent).detail?.kind as MascotOneshotKind;
        if (!kind) return;
        if (reduceMotion && (kind === "jump" || kind === "done" || kind === "spin" || kind === "drop")) return;
        // Latest wins: overwrite, never queue.
        oneshot.current = {
          kind,
          start: performance.now() / 1000,
        };
      } catch {}
    };
    window.addEventListener(MASCOT_EVENT, handler as EventListener);
    return () => window.removeEventListener(MASCOT_EVENT, handler as EventListener);
  }, [reduceMotion]);

  useFrame((state, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(0.05, rawDt || 0.016);
    const t = state.clock.elapsedTime;
    const now = performance.now() / 1000;

    // Entrance: 0.5s of wall time after the first rendered frame, the mascot
    // drops from the sky. Waits out only a currently-playing gag — a
    // finished earlier gag (e.g. an early hover giggle) must NOT cancel it,
    // or casual mouse movement would silently eat the entrance.
    if (!reduceMotion && !dropSettled.current) {
      if (bornAt.current === null) bornAt.current = now;
      if (now - bornAt.current >= 0.5) {
        if (!oneshot.current) {
          dropSettled.current = true;
          oneshot.current = { kind: "drop", start: now };
          try {
            console.debug("[mascot] entrance drop fired");
          } catch {}
        }
      }
    }

    // ---- base (idle breathing) ----
    const breathY = reduceMotion ? 0 : Math.sin(t * 2.1) * 0.022;
    const breathSquash = reduceMotion ? 0 : Math.sin(t * 2.1 + 0.6) * 0.018;

    // ---- gaze source: cursor normally, response anchor while running ----
    // The moment you send a message the mascot turns to watch the answer
    // stream in; cursor pursuit resumes when the run finishes.
    const running = !reduceMotion && modeRef.current !== "idle";
    const gx = running ? responseRef.current.x : cursorRef.current.x;
    const gy = running ? responseRef.current.y : cursorRef.current.y;
    const cd = cursorRef.current.d;
    // Threshold staging: pupils always travel the full gaze, the body only
    // joins past the dead zone — and hops a little to get there.
    const gazeMag = Math.hypot(gx, gy);
    const bodyW = reduceMotion ? 0 : sstep(EYE_ONLY_R, FULL_BODY_R, gazeMag);
    let hopY = 0;
    if (!reduceMotion && !oneshot.current) {
      const beyond = gazeMag > FULL_BODY_R;
      if (beyond && !wasBeyond.current && hopT.current > HOP_DUR + 0.1) {
        hopT.current = 0;
      }
      wasBeyond.current = beyond;
      hopT.current += dt;
      if (hopT.current < HOP_DUR) {
        hopY = Math.sin((Math.PI * hopT.current) / HOP_DUR) * HOP_H;
      }
    } else {
      wasBeyond.current = gazeMag > FULL_BODY_R;
      hopT.current = Math.max(hopT.current, HOP_DUR);
    }
    const cursorRy = reduceMotion ? 0 : gx * 0.65 * bodyW;
    const cursorRx = reduceMotion ? 0 : -gy * 0.38 * bodyW;
    const cursorLookX = reduceMotion ? 0 : gx * 0.13;
    const cursorLookY = reduceMotion ? 0 : gy * 0.1;
    // Close hover = excited: wide eyes + happy tremble (idle only).
    const exc = reduceMotion || running ? 0 : cd;
    const excWide = exc * exc * 0.7;
    const excBob = exc * 0.028 * Math.sin(t * 8);
    const excRz = exc * 0.06 * Math.sin(t * 6);

    // ---- idle saccades: dart the gaze when the pointer is far away ----
    let sacX = 0;
    let sacY = 0;
    if (!reduceMotion && !running && !listeningRef.current) {
      const cursorMag = Math.hypot(gx, gy);
      const s = saccade.current;
      if (t >= s.next && cursorMag < 0.3 && !oneshot.current) {
        s.x = (Math.random() - 0.5) * 0.12;
        s.y = (Math.random() - 0.5) * 0.08;
        s.until = t + 0.4 + Math.random() * 0.5;
        s.next = t + 3 + Math.random() * 3.5;
      }
      if (t < s.until) {
        sacX = s.x;
        sacY = s.y;
      }
    }

    // ---- continuous mode (working only) ----
    // Tool calls deliberately do nothing special: while a run is active the
    // mascot just keeps watching the response (see gaze source above) with
    // the same gentle working bob. "tool"/"browser" modes are treated as
    // working for backwards compat in case something still sets them.
    const mode = modeRef.current;
    let modeRx = 0;
    let modeRz = 0;
    let modeLookX = 0;
    let modeBlink = 0;
    let modeBob = 0;
    if (!reduceMotion && mode !== "idle") {
      modeBob = Math.sin(t * 6) * 0.02;
      modeLookX = Math.sin(t * 1.4) * 0.045;
      modeBlink = 0.12;
    }

    // ---- one-shot timeline (latest wins, skipped intermediates vanish) ----
    let os: Partial<Pose> = {};
    const active = oneshot.current;
    if (active && active.kind !== prevKind.current) {
      // A drop starts 2.4 units up — off-screen at this camera — and rolls
      // fresh random drift/lean so every fall reads a little different.
      if (active.kind === "drop") {
        cur.current.y = 2.4;
        dropSeed.current = {
          drift: (Math.random() - 0.5) * 0.4,
          tilt: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.18),
        };
      }
    }
    prevKind.current = active?.kind ?? null;
    if (active) {
      const dur = ONE_SHOT_DUR[active.kind];
      const p = (now - active.start) / dur;
      if (p >= 1) {
        // A finished spin leaves ry near 2π — wrap it so the rig doesn't
        // unwind backwards toward 0.
        if (active.kind === "spin") cur.current.ry -= Math.PI * 2;
        oneshot.current = null;
      } else {
        os = sampleOneshot(active.kind, p, dropSeed.current);
      }
    }

    // Talking to it: while the composer (typing bar) is focused — and no
    // run is active — the mascot looks AT you, like someone listening.
    // Once you send, `running` takes over and it turns to the response.
    const listening = !running && listeningRef.current && !reduceMotion;
    const pursuit = listening ? 0.12 : 1;
    const listenRx = listening ? 0.09 : 0;
    const listenBob = listening ? Math.sin(t * 3) * 0.015 : 0;
    const listenWide = listening ? 0.25 : 0;

    // During nod/done/listening the gaze locks to the viewer.
    const lookLock =
      listening || (active && (active.kind === "nod" || active.kind === "done"));
    // Pre-entrance: park off-screen above until the drop fires, so the
    // mascot arrives BY falling instead of sitting around first. Ends the
    // moment anything plays (drop — or an early jump, which swoops it in).
    const preDrop =
      !reduceMotion && !dropSettled.current && !oneshot.current && prevKind.current === null;
    const tgt: Pose = {
      y: (preDrop ? 2.4 : breathY + modeBob + excBob + listenBob + hopY) + (os.y ?? 0),
      x: os.x ?? 0,
      rx: cursorRx * pursuit + listenRx + modeRx + (os.rx ?? 0),
      ry: cursorRy * pursuit + (os.ry ?? 0),
      rz: modeRz + excRz + (os.rz ?? 0),
      squash: breathSquash + (os.squash ?? 0),
      wide: (os.wide ?? 0) + excWide + listenWide,
      lookX: lookLock ? (os.lookX ?? 0) : cursorLookX + modeLookX + sacX + (os.lookX ?? 0),
      lookY: lookLock ? (os.lookY ?? 0) : cursorLookY + sacY + (os.lookY ?? 0),
      blink: 0, // computed below (max of sources)
    };

    // Procedural blink every ~2.5–5s, 0.18s close-open.
    // Blinks twice as often while the cursor hovers close (attentive).
    let autoBlink = 0;
    if (!reduceMotion) {
      if (t >= nextBlinkAt.current) {
        const bp = (t - nextBlinkAt.current) / 0.18;
        if (bp >= 1) {
          const gap = (2.5 + Math.random() * 2.5) / (1 + exc * 1.5);
          nextBlinkAt.current = t + gap;
        } else {
          autoBlink = Math.sin(Math.PI * bp);
        }
      }
    }
    tgt.blink = Math.min(1, Math.max(os.blink ?? 0, modeBlink, autoBlink));
    tgt.wide = Math.min(1, tgt.wide);

    // ---- smooth-damp every channel toward target ----
    const c = cur.current;
    c.y = THREE.MathUtils.damp(c.y, tgt.y, 12, dt);
    // Pavement: the origin never sinks below the floor.
    if (c.y < 0) c.y = 0;
    c.x = THREE.MathUtils.damp(c.x, tgt.x, 12, dt);
    c.rx = THREE.MathUtils.damp(c.rx, tgt.rx, 9, dt);
    c.ry = THREE.MathUtils.damp(c.ry, tgt.ry, 9, dt);
    c.rz = THREE.MathUtils.damp(c.rz, tgt.rz, 9, dt);
    c.squash = THREE.MathUtils.damp(c.squash, tgt.squash, 11, dt);
    c.blink = THREE.MathUtils.damp(c.blink, tgt.blink, 22, dt);
    c.lookX = THREE.MathUtils.damp(c.lookX, tgt.lookX, 10, dt);
    c.lookY = THREE.MathUtils.damp(c.lookY, tgt.lookY, 10, dt);
    c.wide = THREE.MathUtils.damp(c.wide, tgt.wide, 10, dt);

    // ---- apply ----
    g.position.y = c.y;
    // Hops travel along the tilted plane instead of straight up.
    g.position.x = c.x + c.y * 0.12;
    g.rotation.set(c.rx + PLANE_RX, c.ry, c.rz + PLANE_RZ);
    const sxz = 1 - c.squash * 0.55;
    g.scale.set(sxz, 1 + c.squash, sxz);

    const lid = 1 - c.blink * 0.88;
    const wideScale = 1 + c.wide * 0.12;
    const esy = Math.max(0.08, lid) * wideScale;
    // Pupils swivel toward the cursor on top of sliding across the face.
    const yaw = c.lookX * 2.2;
    const pitch = -c.lookY * 1.8;
    if (leftEye.current) {
      leftEye.current.scale.set(1, esy, 1);
      leftEye.current.position.set(-MASCOT.eyeX + c.lookX, MASCOT.eyeY + c.lookY, MASCOT.eyeZ);
      leftEye.current.rotation.set(0.06 + pitch, -0.12 + yaw, -0.02);
    }
    if (rightEye.current) {
      rightEye.current.scale.set(1, esy, 1);
      rightEye.current.position.set(MASCOT.eyeX + c.lookX, MASCOT.eyeY + c.lookY, MASCOT.eyeZ);
      rightEye.current.rotation.set(0.06 + pitch, 0.12 + yaw, 0.02);
    }
    // Glints ride the eyes and fade as lids close.
    const glintScale = Math.max(0.001, lid);
    for (const [glint, sx] of [
      [leftGlint.current, -1],
      [rightGlint.current, 1],
    ] as const) {
      if (!glint) continue;
      glint.position.set(
        sx * MASCOT.eyeX + c.lookX + 0.055,
        MASCOT.eyeY + c.lookY + 0.12,
        MASCOT.eyeZ + 0.095,
      );
      glint.scale.setScalar(glintScale);
      (glint.material as THREE.MeshBasicMaterial).transparent = true;
      (glint.material as THREE.MeshBasicMaterial).opacity = glintScale * 0.75;
    }
  });

  return (
    <group ref={group} name="MascotCharacter">
      <mesh geometry={bodyGeom} castShadow={false} receiveShadow={false}>
        <meshPhysicalMaterial
          color="#eef1f5"
          roughness={0.55}
          metalness={0}
          clearcoat={0.15}
          clearcoatRoughness={0.6}
        />
      </mesh>
      <mesh ref={leftEye} geometry={eyeGeom}>
        <meshStandardMaterial color="#0a0b0e" roughness={0.32} metalness={0} />
      </mesh>
      <mesh ref={rightEye} geometry={eyeGeom}>
        <meshStandardMaterial color="#0a0b0e" roughness={0.32} metalness={0} />
      </mesh>
      <mesh ref={leftGlint} geometry={glintGeom}>
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <mesh ref={rightGlint} geometry={glintGeom}>
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

// Direction from the mascot to the thread viewport, normalized to -1..1.
// Recomputed when a run starts so the mascot genuinely turns to face the
// answer (sidebar left, thread right-down) instead of chasing the cursor.
function computeResponseAnchor(mascotEl: HTMLElement | null): { x: number; y: number } | null {
  try {
    if (!mascotEl) return null;
    const vp = (document.querySelector(
      "[data-slot='aui_thread-viewport']",
    ) as HTMLElement | null) || (document.querySelector("main") as HTMLElement | null);
    if (!vp) return null;
    const m = mascotEl.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    if (v.width === 0 || v.height === 0) return null;
    const dx = v.left + v.width / 2 - (m.left + m.width / 2);
    const dyDown = v.top + v.height / 2 - (m.top + m.height / 2);
    return {
      x: Math.max(-1, Math.min(1, dx / 700)),
      y: Math.max(-1, Math.min(1, -dyDown / 700)),
    };
  } catch {
    return null;
  }
}

// Only real typing counts as "talking to it": subscribes to the composer
// text and raises the listening flag while there's something typed.
// Mere focus/click does nothing. Nods once per typing burst (throttled).
function MascotListeningProbe({
  listeningRef,
}: {
  listeningRef: React.MutableRefObject<boolean>;
}) {
  const text = useAuiState(
    (s) => ((s.composer as unknown as { text?: string })?.text ?? "") as string,
  );
  const hasText = text.trim().length > 0;
  const prev = useRef(false);
  const lastNod = useRef(0);
  useEffect(() => {
    listeningRef.current = hasText;
    if (hasText && !prev.current) {
      const now = Date.now();
      if (now - lastNod.current > 2500) {
        lastNod.current = now;
        try {
          window.dispatchEvent(new CustomEvent(MASCOT_EVENT, { detail: { kind: "nod" } }));
        } catch {}
      }
    }
    prev.current = hasText;
  }, [hasText, listeningRef]);
  return null;
}
// Watches thread state and drives mode + one-shots:
// - run starts → anchor gaze to the response, mascot watches it stream in
// - tool calls → deliberately nothing special (mascot keeps watching the
//   response with the normal working bob; no side-turn, no scan)
// - run finishes → "done" (nod, brief eye contact, then back to cursor)
function MascotDriver({
  modeRef,
  responseRef,
  mascotRef,
}: {
  modeRef: React.MutableRefObject<MascotMode>;
  responseRef: React.MutableRefObject<{ x: number; y: number }>;
  mascotRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const prevRunning = useRef(isRunning);

  useEffect(() => {
    modeRef.current = "idle";
    prevRunning.current = isRunning;
    // Sane default anchor (thread is right-down of the sidebar mascot)
    // until the first real measurement.
    responseRef.current = { x: 0.65, y: -0.1 };
    try {
      const a = computeResponseAnchor(mascotRef.current);
      if (a) responseRef.current = a;
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      modeRef.current = !isRunning ? "idle" : "working";

      // Run just started → turn to the response and watch it stream in.
      if (!prevRunning.current && isRunning) {
        try {
          const a = computeResponseAnchor(mascotRef.current);
          if (a) responseRef.current = a;
        } catch {}
      }

      // Response just ended → nod + look at you.
      if (prevRunning.current && !isRunning) {
        window.dispatchEvent(new CustomEvent(MASCOT_EVENT, { detail: { kind: "done" } }));
      }
      prevRunning.current = isRunning;
    } catch {}
  }, [isRunning, modeRef, responseRef, mascotRef]);

  return null;
}

export function MascotMini({ size = 24 }: { size?: number }) {
  const [mounted, setMounted] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<MascotMode>("idle");
  const cursorRef = useRef({ x: 0, y: 0, d: 0 });
  // True while the typing bar (composer) is focused — the mascot looks at
  // you, like someone listening.
  const listeningRef = useRef(false);
  const responseRef = useRef({ x: 0.65, y: -0.1 });
  const lastGiggle = useRef(0);
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // Static logo is a last resort: only shown 5s after load if the 3D
  // mascot never became available (no WebGL / mount failure).
  const [fallbackReady, setFallbackReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setFallbackReady(true), 5000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    setMounted(true);
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) setWebgl(false);
    } catch {
      setWebgl(false);
    }
  }, []);

  // Global cursor → mascot-centric pursuit vector.
  // x: right+, y: up+, d: closeness 1 = on top of the mascot.
  // Direction + tanh falloff means the pupils genuinely point at the
  // cursor — nearby motion reads clearly instead of saturating far away.
  //
  // Follows by default with no click needed: raw pointer coords are stored
  // on every pointer/mouse event from the very first mount (even before the
  // mascot div exists), and the pursuit vector is recomputed every frame
  // from the live mascot rect — so the moment the mascot appears it already
  // points at the last-known pointer, and layout shifts (sidebar
  // expand/collapse, scroll) never leave a stale vector behind.
  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    // Sensible default guess until the first real pointer event: window
    // center-ish, where the pointer usually is on load.
    const raw = {
      x: typeof window !== "undefined" ? window.innerWidth * 0.5 : 0,
      y: typeof window !== "undefined" ? window.innerHeight * 0.35 : 0,
    };
    const target = { x: 0, y: 0, d: 0 };
    const onPos = (clientX: number, clientY: number) => {
      raw.x = clientX;
      raw.y = clientY;
    };
    const onMove = (e: PointerEvent | MouseEvent) => {
      try {
        onPos(e.clientX, e.clientY);
      } catch {}
    };
    const tick = () => {
      try {
        const el = wrapRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          const dx = raw.x - (r.left + r.width / 2);
          const dyDown = raw.y - (r.top + r.height / 2);
          const dist = Math.hypot(dx, dyDown);
          const ux = dist > 0.5 ? dx / dist : 0;
          const uy = dist > 0.5 ? -dyDown / dist : 0; // up positive
          const mag = Math.tanh(dist / 220);
          target.x = ux * mag;
          target.y = uy * mag;
          target.d = 1 - Math.tanh(dist / 160);
        }
      } catch {}
      const c = cursorRef.current;
      c.x += (target.x - c.x) * 0.18;
      c.y += (target.y - c.y) * 0.18;
      c.d += (target.d - c.d) * 0.1;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onMove);
      cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);

  // Manual replay for testing: `__qubeMascotDrop()` in the console.
  useEffect(() => {
    if (!mounted) return;
    try {
      (window as any).__qubeMascotDrop = () => {
        try {
          window.dispatchEvent(new CustomEvent(MASCOT_EVENT, { detail: { kind: "drop" } }));
        } catch {}
      };
    } catch {}
    return () => {
      try {
        delete (window as any).__qubeMascotDrop;
      } catch {}
    };
  }, [mounted]);

  if (!mounted || !webgl) {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        {fallbackReady ? (
          <Image src={logoPng} alt="Qube" width={size - 6} height={size - 6} className="shrink-0" />
        ) : null}
      </span>
    );
  }

  return (
    <>
      <MascotDriver modeRef={modeRef} responseRef={responseRef} mascotRef={wrapRef} />
      <MascotListeningProbe listeningRef={listeningRef} />
      <div
        ref={wrapRef}
        className="shrink-0"
        style={{ width: size, height: size }}
        aria-label="Qube mascot"
        role="img"
        onMouseEnter={() => {
          // Tickled! Throttled happy shiver on hover.
          const now = Date.now();
          if (now - lastGiggle.current < 1200) return;
          lastGiggle.current = now;
          try {
            window.dispatchEvent(new CustomEvent(MASCOT_EVENT, { detail: { kind: "giggle" } }));
          } catch {}
        }}
      >
        <Canvas
          dpr={[1, 2]}
          frameloop="always"
          gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          camera={{ position: [0, 0.05, 5.6], fov: 26 }}
          style={{ background: "transparent" }}
        >
          <ambientLight intensity={1.0} />
          <directionalLight position={[2.5, 3.5, 4]} intensity={0.95} />
          <directionalLight position={[-3, 1, -2]} intensity={0.35} />
          <Suspense fallback={null}>
            <MascotModel
              modeRef={modeRef}
              cursorRef={cursorRef}
              listeningRef={listeningRef}
              responseRef={responseRef}
              reduceMotion={reduceMotion}
            />
          </Suspense>
        </Canvas>
      </div>
    </>
  );
}

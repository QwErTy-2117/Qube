"use client";

import type { CSSProperties, FC } from "react";
import { cn } from "@/lib/utils";

export type EchoRingTone = "working" | "done" | "error";

const TONE_COLOR: Record<EchoRingTone, string> = {
  // working = black in light mode / white in dark mode, done = green, error = red
  working: "text-black dark:text-white",
  done: "text-emerald-500",
  error: "text-red-500",
};

const ECHO_RING_CSS = `@keyframes aui-echo-ring-ripple{0%,100%{opacity:var(--echo-lo,0.15)}50%{opacity:var(--echo-hi,1)}}`;

type EchoRingProps = {
  tone?: EchoRingTone;
  /** Animated ripple while working; static calm rings when settled (done/error). */
  animated?: boolean;
  size?: number;
  className?: string;
  label?: string;
};

/**
 * Echo Ring — concentric diamond ripple loader inspired by
 * dotmatrix Echo Ring (dotm-square-11, concentric diamond ripple
 * with a soft secondary echo pulse per ring).
 *
 * - working: white, animated ripple
 * - done: green, calm static rings
 * - error: red, calm static rings
 */
export const EchoRing: FC<EchoRingProps> = ({
  tone = "working",
  animated,
  size = 16,
  className,
  label,
}) => {
  const isWorking = tone === "working";
  // Calmer when settled: static by default for done/error, animated only while working.
  const shouldAnimate = animated ?? isWorking;
  const grid = 5;
  const center = 2;
  const gap = Math.max(1, Math.round(size / 18));
  const dot = Math.max(2, Math.round((size - gap * (grid - 1)) / grid));

  const dots: Array<{ row: number; col: number; ring: number }> = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const ring = Math.abs(row - center) + Math.abs(col - center);
      dots.push({ row, col, ring });
    }
  }

  return (
    <span
      data-slot="echo-ring"
      data-tone={tone}
      role="status"
      className={cn("inline-flex shrink-0 items-center justify-center", TONE_COLOR[tone], className)}
      style={{ width: size, height: size } as CSSProperties}
    >
      <span className="sr-only">{label ?? tone}</span>
      <style href="aui-echo-ring" precedence="low">
        {ECHO_RING_CSS}
      </style>
      <span
        aria-hidden
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${grid}, ${dot}px)`,
          gridTemplateRows: `repeat(${grid}, ${dot}px)`,
          gap,
        } as CSSProperties}
      >
        {dots.map(({ row, col, ring }) => {
          const staticOpacity = 0.2 + (1 - ring / 4) * 0.75;
          return (
            <span
              key={`${row}-${col}`}
              className="rounded-full bg-current motion-reduce:[animation-name:none]"
              style={
                {
                  width: dot,
                  height: dot,
                  opacity: staticOpacity,
                  ...(shouldAnimate
                    ? {
                        animationName: "aui-echo-ring-ripple",
                        animationDuration: "1.6s",
                        animationTimingFunction: "ease-in-out",
                        animationIterationCount: "infinite",
                        animationDelay: `${-ring * 0.18}s`,
                        "--echo-lo": 0.12,
                        "--echo-hi": 0.25 + (1 - ring / 4) * 0.75,
                      }
                    : {}),
                } as CSSProperties
              }
            />
          );
        })}
      </span>
    </span>
  );
};

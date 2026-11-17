"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuiState } from "@assistant-ui/react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

type UsageSummary = {
  contextWindow: number;
  usedTokens: number;
  remainingTokens: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Current context: system prompt + tool schemas. */
  systemTokens?: number;
  /** Current context: conversation input (prompt minus system). */
  contextInputTokens?: number;
  /** Current context: latest completion. */
  contextOutputTokens?: number;
  costUsd: number | null;
};

type UsageCategory = "system" | "input" | "output";

type UsageSlice = {
  key: UsageCategory;
  label: string;
  hint: string;
  value: number;
  color: string;
};

// Dynamic-island motion: a well-damped spring keeps the width/height morph
// continuous instead of finishing with a snap. The ring layer uses the same
// spring so it grows out of the collapsed pill while the shell opens.
const ISLAND_SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;
// 18px is both the collapsed pill's visible radius (36px tall) and the expanded
// card radius. Animating 999 -> 18 makes the browser clamp every intermediate
// value to half the animating height, then release it near the end of the
// spring — a visible radius snap. Keeping it constant avoids that entirely.
const ISLAND_RADIUS = 18;
// The detail layer is laid out at its final width from the first frame and
// centered on the same axis as the shell, so its text stays put while the
// shell grows/clips around it.
const EXPANDED_WIDTH = 276;
// The collapsed pill only carries the compact token count ("34k"), so it only
// needs enough room for the miniature ring and that short label.
const COLLAPSED_WIDTH = 74;
const COLLAPSED_HEIGHT = 36;
const RING_SIZE = 112;
const COLLAPSED_RING_SIZE = 20;
const RING_VIEWBOX = 120;
const RING_RADIUS = 52;
const RING_STROKE = 12;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_GAP = 2;
// The ring starts at the top edge of the detail card (10px padding), so the
// collapsed dot grows straight down into the chart instead of jumping.
const RING_TOP = 10;
const RING_LEFT = 14;
// Center the 20px collapsed ring on the 36px pill's 18px corner axis.
const COLLAPSED_RING_LEFT = 8;
const COLLAPSED_RING_TOP = 8;
const COLLAPSED_LABEL_LEFT = COLLAPSED_RING_LEFT + COLLAPSED_RING_SIZE + 3;
const SYSTEM_COLOR = "#8b5cf6";
const INPUT_COLOR = "#0ea5e9";
const OUTPUT_COLOR = "#10b981";

function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? Math.floor(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${k >= 10 ? Math.floor(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(value));
}

function formatExactTokens(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function usageModelFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem("qube-default-model") || "";
  } catch {
    return "";
  }
}

/**
 * Segmented context ring. The same SVG is used collapsed (tiny) and expanded
 * (large): the wrapper animates its size/position while the viewBox scales
 * the strokes, so the small graph literally becomes the chart. The center
 * stays empty; hovering a segment highlights it and swaps the matching
 * legend row to its exact token count.
 */
function UsageRing({
  slices,
  total,
  hovered,
  onHover,
}: {
  slices: UsageSlice[];
  total: number;
  hovered: UsageCategory | null;
  onHover: (key: UsageCategory | null) => void;
}) {
  let cursor = 0;
  const arcs = slices.map((slice) => {
    const fraction = total > 0 ? Math.max(0, slice.value) / total : 0;
    const sweep = fraction * 360;
    const start = cursor;
    cursor += sweep;
    const rawLength = fraction * RING_CIRCUMFERENCE;
    const length =
      slice.value > 0
        ? Math.min(RING_CIRCUMFERENCE, Math.max(0.8, rawLength - RING_GAP))
        : 0;
    return { ...slice, start, length };
  });

  return (
    <div className="relative size-full" onPointerLeave={() => onHover(null)}>
      <svg
        viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
        className="size-full"
        aria-hidden="true"
      >
        <circle
          cx={RING_VIEWBOX / 2}
          cy={RING_VIEWBOX / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="text-foreground/10"
        />
        {arcs
          .filter((arc) => arc.length > 0)
          .map((arc) => (
            <circle
              key={arc.key}
              cx={RING_VIEWBOX / 2}
              cy={RING_VIEWBOX / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={arc.color}
              strokeWidth={hovered === arc.key ? RING_STROKE + 2 : RING_STROKE}
              strokeDasharray={`${arc.length} ${RING_CIRCUMFERENCE}`}
              transform={`rotate(${arc.start - 90} ${RING_VIEWBOX / 2} ${RING_VIEWBOX / 2})`}
              opacity={hovered && hovered !== arc.key ? 0.45 : 1}
              style={{
                transition:
                  "stroke-dasharray 500ms ease, stroke-width 80ms ease-out, opacity 80ms ease-out",
              }}
            />
          ))}
        {/* Wider invisible strokes make each thin segment easy to hover. */}
        {arcs
          .filter((arc) => arc.length > 0)
          .map((arc) => (
            <circle
              key={`hit-${arc.key}`}
              cx={RING_VIEWBOX / 2}
              cy={RING_VIEWBOX / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="transparent"
              strokeWidth={22}
              strokeDasharray={`${arc.length} ${RING_CIRCUMFERENCE}`}
              transform={`rotate(${arc.start - 90} ${RING_VIEWBOX / 2} ${RING_VIEWBOX / 2})`}
              pointerEvents="stroke"
              onPointerEnter={() => onHover(arc.key)}
            />
          ))}
      </svg>
    </div>
  );
}

/**
 * Live context usage as a dynamic-island pill.
 *
 * Collapsed it shows `12k` beside a miniature segmented ring.
 * Hovering/focusing springs the same shell open: the ring grows into a chart
 * whose total is the context window, the legend splits it into system, input
 * and output tokens, and the real session price sits underneath. Hovering a
 * segment (or its legend row) immediately shows the exact token count in the
 * legend; the chart center stays empty.
 *
 * Token counts come from provider usage events; system/tool overhead comes
 * from the context-budget telemetry logged for the latest request. Cost is
 * rendered only when a gateway reported it or explicit list pricing is known.
 */
export function SessionUsage({ className }: { className?: string }) {
  const threadIdFromState = useAuiState((s) => {
    const state = s as any;
    return (
      state?.threadListItem?.remoteId ||
      state?.threadListItem?.id ||
      state?.thread?.threadId ||
      ""
    );
  });
  const pathname = usePathname();
  const running = useAuiState((s) => (s as any)?.thread?.isRunning === true);
  const pathThreadId = useMemo(() => {
    const match = /^\/chat\/([^/?#]+)/.exec(pathname || "");
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }, [pathname]);
  const threadId = threadIdFromState || pathThreadId;

  const [model, setModel] = useState(usageModelFromStorage);
  const [refreshKey, setRefreshKey] = useState(0);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<UsageCategory | null>(null);
  // The detail card is absolutely positioned so its size never fights the
  // pill; measuring it lets the island animate height with the same spring
  // as the width (no end-of-motion snap).
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [detailHeight, setDetailHeight] = useState(156);

  useEffect(() => {
    const el = detailRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const height = el.offsetHeight;
      if (height > 0) setDetailHeight(height);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncModel = () => {
      setModel(usageModelFromStorage());
      setRefreshKey((key) => key + 1);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "qube-default-model") syncModel();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("qube-model-changed", syncModel);
    window.addEventListener("qube-providers-changed", syncModel);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("qube-model-changed", syncModel);
      window.removeEventListener("qube-providers-changed", syncModel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (threadId) params.set("threadId", threadId);
        if (model) params.set("model", model);
        const res = await fetch(`/api/usage?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`usage ${res.status}`);
        const data = (await res.json()) as UsageSummary;
        if (!cancelled && Number.isFinite(data.contextWindow)) setUsage(data);
      } catch {
        // Keep the last known value; the next poll retries.
      } finally {
        if (!cancelled) timer = setTimeout(load, running ? 5000 : 15000);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [threadId, model, running, refreshKey]);

  if (!usage || usage.contextWindow <= 0) return null;

  const contextWindow = usage.contextWindow;
  const rawUsed = Math.max(0, usage.usedTokens);
  const percent = Math.max(
    0,
    Math.min(100, Math.round((rawUsed / contextWindow) * 100)),
  );
  const chartTotal = Math.max(contextWindow, rawUsed, 1);
  const cost = usage.costUsd != null ? formatCost(usage.costUsd) : "";

  // Keep the three slices summing exactly to the current usage snapshot. The
  // backend supplies this split from the latest prompt/completion plus the
  // context-budget system/tool estimate; remain tolerant of older threads.
  const systemValue = Math.min(rawUsed, Math.max(0, usage.systemTokens ?? 0));
  const outputValue = Math.min(
    Math.max(0, rawUsed - systemValue),
    Math.max(0, usage.contextOutputTokens ?? 0),
  );
  const inputValue = Math.max(0, rawUsed - systemValue - outputValue);
  const slices: UsageSlice[] = [
    {
      key: "system",
      label: "System",
      hint: "prompt + tools",
      value: systemValue,
      color: SYSTEM_COLOR,
    },
    {
      key: "input",
      label: "Input",
      hint: "conversation",
      value: inputValue,
      color: INPUT_COLOR,
    },
    {
      key: "output",
      label: "Output",
      hint: "response",
      value: outputValue,
      color: OUTPUT_COLOR,
    },
  ];

  const title = [
    `${formatExactTokens(rawUsed)} of ${formatExactTokens(contextWindow)} tokens used (${percent}%)`,
    `${formatExactTokens(systemValue)} system`,
    `${formatExactTokens(inputValue)} input`,
    `${formatExactTokens(outputValue)} output`,
    cost ? `${cost} this session` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const close = () => {
    setExpanded(false);
    setHovered(null);
  };

  return (
    <motion.div
      initial={false}
      animate={{
        width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        height: expanded ? detailHeight : COLLAPSED_HEIGHT,
      }}
      transition={ISLAND_SPRING}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={close}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          close();
        }
      }}
      tabIndex={0}
      role="status"
      aria-label={title}
      title={expanded ? undefined : title}
      className={cn(
        "pointer-events-auto relative overflow-hidden border border-border/55 bg-background/85 text-foreground shadow-[0_8px_30px_-16px_rgba(0,0,0,0.24)] outline-none backdrop-blur-xl focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      style={{ borderRadius: ISLAND_RADIUS }}
    >
      {/* The detail layer is fixed-width and centered on the shell's axis, so
          the shell morphs around stationary copy instead of dragging it
          sideways. It stays mounted so the spring always has a measured
          height target and the two layers can cross-fade. */}
      <div
        className="absolute top-0 left-1/2 z-0 -translate-x-1/2"
        style={{
          width: EXPANDED_WIDTH,
          pointerEvents: expanded ? "auto" : "none",
        }}
        aria-hidden={!expanded}
      >
        <motion.div
          ref={detailRef}
          initial={false}
          animate={{ opacity: expanded ? 1 : 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="relative px-3.5 pt-2.5 pb-2.5"
        >
          {/* The percentage keeps its top-right position while the chart and
              legend move up into the space the old header occupied. */}
          <span className="absolute right-3.5 top-3 text-xs font-semibold leading-none tabular-nums text-foreground">
            {percent}% used
          </span>

          <div className="flex items-center gap-3.5">
            {/* Spacer for the persistent ring layer, which overlays this box. */}
            <div className="size-28 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 py-1">
              {slices.map((slice) => (
                <div
                  key={slice.key}
                  onPointerEnter={() => setHovered(slice.key)}
                  onPointerLeave={() =>
                    setHovered((current) => (current === slice.key ? null : current))
                  }
                  className={cn(
                    "-mx-1 flex items-center gap-1.5 rounded-md px-1 py-[3px] text-[10.5px] leading-none transition-colors duration-75 hover:bg-muted/50",
                    hovered === slice.key && "bg-muted/60",
                  )}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="truncate text-muted-foreground">{slice.label}</span>
                  <span className="ml-auto pl-1 font-medium tabular-nums text-foreground/80">
                    {hovered === slice.key
                      ? formatExactTokens(slice.value)
                      : formatTokens(slice.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex h-4 items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Session cost</span>
            <span className="font-semibold tabular-nums text-foreground">
              {cost || "—"}
            </span>
          </div>
        </motion.div>
      </div>

      {/* One persistent ring morphs from the 20px collapsed dot into the
          expanded chart; the shell and the ring share the same spring. */}
      <motion.div
        initial={false}
        animate={{
          left: expanded ? RING_LEFT : COLLAPSED_RING_LEFT,
          top: expanded ? RING_TOP : COLLAPSED_RING_TOP,
          width: expanded ? RING_SIZE : COLLAPSED_RING_SIZE,
          height: expanded ? RING_SIZE : COLLAPSED_RING_SIZE,
        }}
        transition={ISLAND_SPRING}
        className="absolute z-20"
        style={{ pointerEvents: expanded ? "auto" : "none" }}
      >
        <UsageRing
          slices={slices}
          total={chartTotal}
          hovered={hovered}
          onHover={setHovered}
        />
      </motion.div>

      <motion.div
        initial={false}
        animate={{ opacity: expanded ? 0 : 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="absolute inset-0 z-10 flex h-9 items-center"
        style={{ paddingLeft: COLLAPSED_LABEL_LEFT, paddingRight: 6 }}
        aria-hidden={expanded}
      >
        <span className="w-full whitespace-nowrap text-center text-[13px] font-semibold leading-none tabular-nums">
          {formatTokens(rawUsed)}
        </span>
      </motion.div>
    </motion.div>
  );
}

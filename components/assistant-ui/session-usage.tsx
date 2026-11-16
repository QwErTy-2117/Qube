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
  costUsd: number | null;
};

// Dynamic-island motion: a well-damped spring keeps the width/height morph
// continuous instead of finishing with a snap.
const ISLAND_SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;
// The detail layer is laid out at its final width from the first frame. If it
// followed the animating shell instead, the text would reflow every frame and
// ResizeObserver would keep changing the measured height target — the snap.
const EXPANDED_WIDTH = 276;

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
 * Live context usage as a dynamic-island pill.
 *
 * Collapsed it shows only the used share of the context window (ring + %),
 * centered at the top of the thread. Hovering/focusing morphs it into a
 * compact detail card with the used/window graph, the session's input and
 * output token split, and the real session price when one is known.
 *
 * Token counts come from provider usage events; cost is rendered only when a
 * gateway reported it or explicit list pricing is known — free, local,
 * subscription, and unpriced models show context alone.
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
  // The detail card is absolutely positioned so its size never fights the
  // pill; measuring it lets the island animate height with the same spring
  // as the width (no end-of-motion snap).
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [detailHeight, setDetailHeight] = useState(196);

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

  // Used context, not remaining: the ring fills up as the window is consumed.
  const contextWindow = usage.contextWindow;
  const used = Math.max(0, Math.min(usage.usedTokens, contextWindow));
  const fraction = contextWindow > 0 ? used / contextWindow : 0;
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const radius = 6.75;
  const circumference = 2 * Math.PI * radius;
  const arc = Math.max(0, Math.min(circumference, circumference * fraction));
  const cost = usage.costUsd != null ? formatCost(usage.costUsd) : "";
  const input = Math.max(0, usage.inputTokens);
  const output = Math.max(0, usage.outputTokens);
  const sessionTokens = input + output;
  const inputShare = sessionTokens > 0 ? (input / sessionTokens) * 100 : 0;
  const outputShare = sessionTokens > 0 ? (output / sessionTokens) * 100 : 0;
  const title = [
    `${percent}% of context used`,
    `${formatTokens(used)} of ${formatTokens(contextWindow)} tokens`,
    `${formatTokens(usage.remainingTokens)} left`,
    cost ? `${cost} this session` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <motion.div
      initial={false}
      animate={{
        width: expanded ? EXPANDED_WIDTH : 88,
        height: expanded ? detailHeight : 36,
        borderRadius: expanded ? 18 : 999,
      }}
      transition={ISLAND_SPRING}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setExpanded(false);
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
    >
      {/* Both layers stay mounted so opacity cross-fades while the shell's
          width/height spring runs; nothing swaps in a single frame. */}
      <motion.div
        ref={detailRef}
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="absolute top-0 left-0 px-3.5 pt-3 pb-3"
        style={{ width: EXPANDED_WIDTH }}
        aria-hidden={!expanded}
      >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-muted-foreground">
                Context used
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {percent}%
              </span>
            </div>

            {/* Used-context graph: fills left → right as the window is used. */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={false}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="h-full rounded-full bg-foreground/75"
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/80">
              <span>{formatTokens(used)} used</span>
              <span>{formatTokens(contextWindow)} window</span>
            </div>

            <div className="my-2.5 h-px w-full bg-border/60" />

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Session tokens</span>
              <span className="font-medium tabular-nums text-foreground/80">
                {formatTokens(sessionTokens)}
              </span>
            </div>
            <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={false}
                animate={{ width: `${inputShare}%` }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="h-full bg-sky-500"
              />
              <motion.div
                initial={false}
                animate={{ width: `${outputShare}%` }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="h-full bg-emerald-500"
              />
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-sky-500" />
                <span className="truncate text-muted-foreground">Input</span>
                <span className="ml-auto font-medium tabular-nums text-foreground/80">
                  {formatTokens(input)}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate text-muted-foreground">Output</span>
                <span className="ml-auto font-medium tabular-nums text-foreground/80">
                  {formatTokens(output)}
                </span>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
              <span className="text-muted-foreground">Session cost</span>
              <span className="font-semibold tabular-nums text-foreground">
                {cost || "—"}
              </span>
            </div>
      </motion.div>

      <motion.div
        initial={false}
        animate={{ opacity: expanded ? 0 : 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex h-9 w-full items-center justify-center gap-1.5"
        aria-hidden={expanded}
      >
        <svg
          viewBox="0 0 18 18"
          className="size-4 shrink-0 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            opacity="0.18"
          />
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
            className="text-foreground/80 transition-[stroke-dasharray] duration-500"
          />
        </svg>
        <span className="whitespace-nowrap text-[11px] font-medium leading-none tabular-nums">
          {percent}% used
        </span>
      </motion.div>
    </motion.div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuiState } from "@assistant-ui/react";

import { cn } from "@/lib/utils";

type UsageSummary = {
  contextWindow: number;
  usedTokens: number;
  remainingTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

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
 * Remaining context + real session cost, pinned to the thread's top-right
 * corner. Token counts come from provider usage events; the small ring fills
 * with the remaining share of the model's context window. Cost is rendered
 * only when a gateway reported it or explicit list pricing is known — free,
 * local, subscription, and unpriced models show context alone.
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

  const remaining = Math.max(0, Math.min(usage.remainingTokens, usage.contextWindow));
  const fraction = usage.contextWindow > 0 ? remaining / usage.contextWindow : 0;
  const radius = 6.25;
  const circumference = 2 * Math.PI * radius;
  const arc = Math.max(0, Math.min(circumference, circumference * fraction));
  const cost = usage.costUsd != null ? formatCost(usage.costUsd) : "";
  const used = Math.max(0, usage.usedTokens);
  const title = [
    `${formatTokens(remaining)} context left`,
    `${formatTokens(used)} of ${formatTokens(usage.contextWindow)} used`,
    cost ? `${cost} this session` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "text-muted-foreground/80 flex h-7 items-center gap-1.5 rounded-full border border-border/50 bg-background/65 px-2.5 text-[11px] font-medium tabular-nums shadow-sm backdrop-blur-md",
        className,
      )}
      title={title}
      aria-label={title}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          opacity="0.22"
        />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          className="text-foreground/80 transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <span className="leading-none">{formatTokens(remaining)}</span>
      {cost ? (
        <>
          <span className="text-muted-foreground/40" aria-hidden="true">
            ·
          </span>
          <span className="leading-none">{cost}</span>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { MonitorIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { openComputerWorkspace, useWorkspaceStore } from "@/lib/workspace/store";

type ComputerCardState = {
  running: boolean;
  active: boolean;
  files: number;
  browserRunning: boolean;
};

/**
 * Qube Computer card — the same visual language as the Goals card: a small
 * rounded rectangle that names itself on hover and opens the side panel with
 * the real session. It sits out of the way (bottom-right) and hides while the
 * panel is open.
 */
export function QubeComputerCard() {
  const panelOpen = useWorkspaceStore((s) => s.open && s.artifact?.kind === "computer");
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<ComputerCardState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/computer", { cache: "no-store" });
        const json = (await res.json()) as {
          ok?: boolean;
          session?: { lastActiveAt?: string };
          usage?: { files?: number };
          browser?: { running?: boolean };
          activity?: Array<{ at: string }>;
        };
        if (cancelled || json?.ok === false) return;
        const lastActivity = json.activity?.length ? new Date(json.activity[json.activity.length - 1].at).getTime() : 0;
        setState({
          running: true,
          active: Date.now() - lastActivity < 5 * 60 * 1000,
          files: json.usage?.files ?? 0,
          browserRunning: !!json.browser?.running,
        });
      } catch {
        if (!cancelled) setState(null);
      }
    };
    void load();
    // Cheap local status ping: only refreshes the little activity dot.
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <AnimatePresence>
      {!panelOpen && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.18, ease: "easeOut" }}
          className="pointer-events-none fixed right-5 bottom-5 z-40"
        >
          <button
            type="button"
            onClick={() => openComputerWorkspace()}
            aria-label="Open Qube Computer"
            title="Qube Computer"
            className={cn(
              "group pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-2.5 shadow-lg backdrop-blur-xl",
              "transition-colors hover:border-border/80 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            )}
          >
            <span className="relative flex size-4 items-center justify-center">
              <MonitorIcon className="size-4 text-foreground/80" aria-hidden />
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background",
                  state?.active ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
            </span>
            <span className="max-w-0 overflow-hidden text-[13px] font-medium whitespace-nowrap text-foreground opacity-0 transition-all duration-200 group-hover:max-w-[9rem] group-hover:opacity-100 group-focus-visible:max-w-[9rem] group-focus-visible:opacity-100">
              Qube Computer
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

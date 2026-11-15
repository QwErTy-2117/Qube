"use client";

import { useEffect, useState } from "react";
import { ArrowUpRightIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type HomeTodoItem = {
  id: string;
  title: string;
  meta: string;
  done: boolean;
  kind: "heartbeat" | "reminder" | "today";
};

const POLL_MS = 30_000;

/**
 * Minimal new-chat checklist: what the next heartbeat will work on, open
 * reminders, and today's scheduled tasks. It is mounted only on the landing
 * view, so sending the first message removes it naturally.
 */
export function HomeTodo({ className }: { className?: string }) {
  const [items, setItems] = useState<HomeTodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await fetch("/api/proactivity/work", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setItems(Array.isArray(data?.items) ? data.items : []);
          }
        }
      } catch {
        // Keep the last list; the next poll retries.
      } finally {
        if (!cancelled) {
          setLoaded(true);
          timer = setTimeout(load, POLL_MS);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const openTasks = () => {
    window.dispatchEvent(
      new CustomEvent("qube-open-settings", { detail: { tab: "scheduling" } }),
    );
  };

  // One item is not a list — stay out of the way until there is real work.
  if (!loaded || items.length <= 1) return null;

  const remaining = items.filter((item) => !item.done).length;

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-h-[280px] w-[320px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/75 text-left shadow-[0_10px_36px_-24px_rgba(0,0,0,0.35)] backdrop-blur-md",
        className,
      )}
    >
      <button
        type="button"
        onClick={openTasks}
        className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2 text-left transition-colors hover:bg-muted/20"
        title="Open Tasks"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            to-do
          </span>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground/70">
            {remaining} left
          </span>
        </span>
        <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      </button>

      <div className="min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2 scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={openTasks}
            className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted/30"
            title={item.title}
          >
            <span
              className={cn(
                "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                item.done
                  ? "border-muted-foreground/25 bg-muted/40 text-muted-foreground"
                  : "border-muted-foreground/35",
              )}
              aria-hidden="true"
            >
              {item.done ? <XIcon className="size-2.5" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-[12.5px] leading-5",
                  item.done
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {item.title}
              </span>
              <span className="block truncate text-[10px] leading-4 text-muted-foreground/65">
                {item.meta}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

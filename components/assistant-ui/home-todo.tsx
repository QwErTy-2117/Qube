"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { orderTodoItems } from "@/lib/todo/display";

type HomeTodoItem = {
  id: string;
  title: string;
  done: boolean;
  kind: "heartbeat" | "reminder" | "today";
  taskId?: string;
  workId?: string;
};

const POLL_MS = 30_000;

function openTasksSection(taskId?: string, workId?: string) {
  window.dispatchEvent(
    new CustomEvent("qube-open-settings", {
      detail: {
        tab: "scheduling",
        section: "todo",
        ...(taskId ? { taskId } : {}),
        ...(workId ? { workId } : {}),
      },
    }),
  );
}

/**
 * Compact new-chat checklist: what the next heartbeat will work on, open
 * reminders, and today's scheduled tasks. It is mounted only on the landing
 * view, so sending the first message removes it naturally. Collapsed it keeps
 * just the same slim header row as the goals panel.
 */
export function HomeTodo({ className }: { className?: string }) {
  const [items, setItems] = useState<HomeTodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // A stable per-mount seed randomizes the rows without reshuffling them on
  // every 30-second poll.
  const [orderSeed] = useState(() => Math.random());

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
  }, [reloadKey]);

  useEffect(() => {
    const reload = () => setReloadKey((key) => key + 1);
    window.addEventListener("qube-tasks-changed", reload);
    return () => window.removeEventListener("qube-tasks-changed", reload);
  }, []);

  const ordered = useMemo(
    () => orderTodoItems(items, orderSeed),
    [items, orderSeed],
  );

  // One item is not a list — stay out of the way until there is real work.
  if (!loaded || items.length <= 1) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "pointer-events-auto w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background/95 p-3 text-left shadow-lg backdrop-blur-xl",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
        title={expanded ? "Collapse to-do list" : "Expand to-do list"}
      >
        <span className="min-w-0 text-[13px] font-semibold text-foreground">
          to-do
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            !expanded && "-rotate-90",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pt-2">
              {ordered.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openTasksSection(item.taskId, item.workId)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
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
                    {item.done ? (
                      <CheckIcon className="size-2.5" strokeWidth={3} />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "block min-w-0 flex-1 truncate text-[12.5px] leading-5",
                      item.done
                        ? "text-muted-foreground line-through"
                        : "text-foreground",
                    )}
                  >
                    {item.title}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

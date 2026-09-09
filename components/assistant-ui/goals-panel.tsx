"use client";

import { useState, type FC } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDownIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuiState } from "@assistant-ui/react";

type Todo = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
};

function extractTodos(messages: any[]): { todos: Todo[]; running: boolean } | null {
  let last: Todo[] | null = null;
  let running = false;
  for (const msg of messages) {
    const parts: any[] = (msg as any).content || (msg as any).parts || [];
    for (const part of parts) {
      if (part?.type === "tool-call" && part?.toolName === "TodoWrite") {
        const args = (part as any).args as any;
        if (args && Array.isArray(args.todos)) {
          last = args.todos as Todo[];
        }
        if ((part as any).status?.type === "running") running = true;
      }
    }
  }
  if (!last) return null;
  return { todos: last, running };
}

/**
 * GoalsPanel — docked TodoWrite checklist above the composer.
 * Matches screenshots: "1 of 8 todos completed" + current task,
 * expandable numbered list, clears when all done (cc-style).
 */
export const GoalsPanel: FC = () => {
  const messages = useAuiState((s) => s.thread.messages);
  const [expanded, setExpanded] = useState(false);

  const data = extractTodos(messages as any[]);
  if (!data || data.todos.length === 0) return null;

  const { todos, running } = data;
  const done = todos.filter((t) => t.status === "completed").length;
  // cc "all done → clear the panel"
  if (done === todos.length && todos.length > 0) return null;

  const currentIdx = todos.findIndex((t) => t.status === "in_progress");
  const current = currentIdx >= 0 ? todos[currentIdx] : null;

  return (
    <div
      data-slot="aui_goals-panel"
      className="w-full overflow-hidden rounded-2xl border border-border bg-background shadow-lg"
    >
      {/* Header — count + current task (collapsed) or count only (expanded) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-background px-4 py-2.5 text-left transition-colors hover:bg-muted"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2 truncate text-sm">
          <span className="shrink-0 text-muted-foreground">
            {done} of {todos.length} todos completed
          </span>
          {!expanded && current && (
            <span className="truncate text-muted-foreground/80">
              {currentIdx + 1}. {current.content}
            </span>
          )}
          {expanded && current && (
            <span className="truncate text-muted-foreground/80">
              {currentIdx + 1}. {current.content}
            </span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            expanded && "rotate-180"
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
            className="border-t border-border/40 bg-background px-4 py-2.5"
          >
            <ol className="space-y-1.5">
              {todos.map((todo, i) => {
                const completed = todo.status === "completed";
                const active = todo.status === "in_progress";
                return (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                      {completed ? (
                        <span className="flex size-4 items-center justify-center rounded-full border border-border/60 text-muted-foreground">
                          <CheckIcon className="size-3" />
                        </span>
                      ) : active ? (
                        <span
                          className={cn(
                            "size-1.5 rounded-full bg-foreground/70",
                            running && "animate-pulse"
                          )}
                        />
                      ) : (
                        <span className="size-1.5 rounded-full bg-transparent" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "leading-snug",
                        completed
                          ? "text-muted-foreground/60 line-through"
                          : active
                            ? "text-foreground"
                            : "text-muted-foreground"
                      )}
                    >
                      {i + 1}. {todo.content}
                    </span>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

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

function GoalNumber({
  index,
  status,
}: {
  index: number;
  status: Todo["status"];
}) {
  if (status === "completed") {
    // Full: solid blue circle with white check (was a number + spinner).
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2f7cf6] text-white">
        <CheckIcon className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (status === "in_progress") {
    // Number with a spinning wheel: blue number + thin rotating arc over a
    // faint track. The whole ring spins while the item is active.
    return (
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        <span className="flex size-7 items-center justify-center rounded-full text-[15px] font-medium text-[#2f7cf6]">
          {index + 1}
        </span>
        <svg
          className="absolute inset-0 size-7 origin-center animate-spin [animation-duration:0.9s]"
          style={{ transformOrigin: "center" }}
          viewBox="0 0 28 28"
          fill="none"
          aria-hidden
        >
          <circle
            cx="14"
            cy="14"
            r="12"
            stroke="#2f7cf6"
            strokeOpacity="0.15"
            strokeWidth="2"
          />
          <circle
            cx="14"
            cy="14"
            r="12"
            stroke="#2f7cf6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="14 62"
            strokeDashoffset="0"
          />
        </svg>
      </span>
    );
  }
  // Pending: gray number in a soft circle.
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-medium text-muted-foreground">
      {index + 1}
    </span>
  );
}

/**
 * GoalsPanel — docked TodoWrite checklist above the composer.
 * Cowork-style "Progress" card: numbered circles, the active number carries
 * a spinning wheel that becomes a full blue check when done.
 */
export const GoalsPanel: FC = () => {
  const messages = useAuiState((s) => s.thread.messages);
  const [expanded, setExpanded] = useState(true);

  const data = extractTodos(messages as any[]);
  if (!data || data.todos.length === 0) return null;

  const { todos } = data;
  const done = todos.filter((t) => t.status === "completed").length;
  // cc "all done → clear the panel"
  if (done === todos.length && todos.length > 0) return null;

  return (
    <div
      data-slot="aui_goals-panel"
      className="w-full overflow-hidden rounded-2xl border border-border bg-background shadow-lg"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-background px-4 py-2.5 text-left transition-colors hover:bg-muted"
      >
        <span className="text-sm font-medium text-foreground">Progress</span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            !expanded && "rotate-180"
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
            className="border-t border-border/40 bg-background px-4 py-3"
          >
            <ol className="space-y-3">
              {todos.map((todo, i) => {
                const completed = todo.status === "completed";
                const active = todo.status === "in_progress";
                return (
                  <li key={i} className="flex items-center gap-3.5">
                    <GoalNumber index={i} status={todo.status} />
                    <span
                      className={cn(
                        "text-[17px] leading-snug",
                        completed
                          ? "text-muted-foreground line-through"
                          : active
                            ? "font-normal text-foreground"
                            : "text-muted-foreground"
                      )}
                    >
                      {todo.content}
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

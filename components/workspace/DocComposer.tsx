"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpIcon } from "lucide-react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { buildContextMessage, type WorkspaceArtifact } from "@/lib/workspace/types";
import { WorkspaceQuote } from "./WorkspaceQuote";

const PLACEHOLDERS: Record<string, string> = {
  pdf: "Describe edits",
  doc: "Describe edits",
  text: "Describe edits",
  sheet: "Describe edits",
  slides: "Describe edits",
  code: "Describe edits",
};

/**
 * Glassy floating composer for the document popup: a translucent pill
 * input with an arrow-up send button when idle; while the agent is
 * writing, a compact three-dots pill (no stop button).
 */
export function DocComposer({ artifact }: { artifact: WorkspaceArtifact }) {
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const selections = useWorkspaceStore((s) => s.selections);
  const removeSelection = useWorkspaceStore((s) => s.removeSelection);
  const clearSelections = useWorkspaceStore((s) => s.clearSelections);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const send = () => {
    const text = value.trim();
    if (!text || sending || isRunning) return;
    setSending(true);
    try {
      aui.thread().append({
        content: [{ type: "text", text: buildContextMessage({ message: text, artifact, selections }) }],
        runConfig: aui.composer().getState().runConfig,
      });
      setValue("");
      clearSelections();
    } finally {
      setSending(false);
    }
  };

  const placeholder =
    selections.length > 0
      ? `Ask about ${selections.length} selected quote${selections.length > 1 ? "s" : ""}…`
      : (PLACEHOLDERS[artifact.kind] || "Describe edits");

  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent px-4 pt-8 pb-4 ${isRunning ? "flex flex-col items-center" : ""}`}>
      <AnimatePresence initial={false}>
        {selections.length > 0 && !isRunning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="pointer-events-auto mb-2 w-full space-y-1.5 overflow-hidden"
          >
            {selections.map((s) => (
              <WorkspaceQuote key={s.id} selection={s} onRemove={removeSelection} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        layout
        transition={{ duration: 0.25, ease: "easeOut" }}
        className={
          isRunning
            ? "pointer-events-auto flex h-9 w-auto min-w-[68px] items-center justify-center rounded-full border border-border bg-popover/85 px-4 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] backdrop-blur-xl dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]"
            : "pointer-events-auto flex w-full items-center gap-2.5 rounded-full border border-border bg-popover/85 py-2 pr-2 pl-4 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-[border-color] focus-within:border-ring/50 dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]"
        }
      >
        {isRunning ? (
          <span className="typing-dots text-muted-foreground" aria-live="polite" aria-label="Agent is writing">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <>
          <textarea
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={placeholder}
            rows={1}
            aria-label="Describe edits"
            className="max-h-28 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <button
            onClick={send}
            disabled={!value.trim() || sending}
            aria-label="Send"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUpIcon className="size-4" strokeWidth={2.5} />
          </button>
          </>
        )}
      </motion.div>
    </div>
  );
}

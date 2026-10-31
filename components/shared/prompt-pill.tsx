"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowUpIcon } from "lucide-react";

export function PromptPill({
  placeholder = "Describe the task — timing optional…",
  busyLabel = "Drafting the task…",
  busy = false,
  onSend,
}: {
  placeholder?: string;
  busyLabel?: string;
  busy?: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  };

  return (
    <motion.div
      layout
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={
        busy
          ? "flex h-9 w-auto min-w-[68px] items-center justify-center rounded-full border border-border bg-popover/85 px-4 backdrop-blur-xl"
          : "flex w-full items-center gap-2.5 rounded-full border border-border bg-popover/85 py-2 pr-2 pl-4 backdrop-blur-xl transition-[border-color] focus-within:border-ring/50"
      }
    >
      {busy ? (
        <span className="typing-dots text-muted-foreground" aria-live="polite" aria-label={busyLabel}>
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
            aria-label={placeholder}
            className="max-h-28 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <button
            onClick={send}
            disabled={!value.trim() || busy}
            aria-label="Send"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUpIcon className="size-4" strokeWidth={2.5} />
          </button>
        </>
      )}
    </motion.div>
  );
}

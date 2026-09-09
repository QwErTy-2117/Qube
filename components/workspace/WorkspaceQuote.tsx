"use client";

import { XIcon, QuoteIcon } from "lucide-react";
import { motion } from "motion/react";
import type { WorkspaceSelection } from "@/lib/workspace/types";

function labelFor(s: WorkspaceSelection): string {
  if (s.kind === "pdf") return `Page ${s.page}`;
  if (s.kind === "doc") return `¶ ${s.paragraph}`;
  if (s.kind === "sheet") return `${s.sheet} ${s.range}`;
  if (s.kind === "slides") return `Slide ${s.slide}`;
  if (s.kind === "code" || s.kind === "text") return `L${s.startLine}–${s.endLine}`;
  if (s.kind === "browser") return new URL(s.url).hostname;
  return "Quote";
}

function previewText(s: WorkspaceSelection): string {
  if (s.kind === "sheet") {
    const flat = s.values.flat().filter(Boolean).join(" · ");
    return flat.slice(0, 140) || `${s.sheet} ${s.range}`;
  }
  return s.text.slice(0, 140);
}

function fullLen(s: WorkspaceSelection): number {
  if (s.kind === "sheet") return s.values.flat().join(" ").length;
  return s.text.length;
}

export function WorkspaceQuote({ selection, onRemove }: { selection: WorkspaceSelection; onRemove: (id: string) => void }) {
  const text = previewText(selection);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="group flex items-start gap-2.5 rounded-2xl border border-border/50 bg-muted px-3.5 py-2.5 text-xs shadow-sm"
    >
      <QuoteIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="mb-1">
          <span className="inline-flex items-center rounded-full border border-border/60 bg-background px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">{labelFor(selection)}</span>
        </div>
        <div className="line-clamp-2 leading-relaxed text-foreground/90">“{text}{fullLen(selection) > 140 ? "…" : ""}”</div>
      </div>
      <button
        onClick={() => onRemove(selection.id)}
        aria-label="Remove quote"
        className="rounded-full p-1 text-muted-foreground opacity-60 transition hover:bg-accent hover:text-foreground hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  );
}

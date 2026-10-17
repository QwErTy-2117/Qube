"use client";

import type { ReactNode } from "react";
import { ToolRow } from "./tool-row";

/**
 * Playful, non-serious verbs for thinking — same voice as the other tool
 * calls ("Sneaking a peek", "Going down a rabbit hole", …). Never the raw
 * "Reasoning"/"Thinking" jargon on its own.
 */
export const THINKING_VERBS = [
  "Noodling on it",
  "Connecting the dots",
  "Putting on thinking cap",
  "Hatching a plan",
  "Turning the gears",
  "Reading between lines",
  "Following a hunch",
  "Sleeping on it",
];

function verbFor(text: unknown): string {
  const s = typeof text === "string" ? text : "";
  if (!s) return THINKING_VERBS[0];
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 128); i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return THINKING_VERBS[h % THINKING_VERBS.length];
}

function summaryFor(text: string, running: boolean): string {
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
    ?.slice(0, 80);
  if (first) return first;
  return running ? "…" : "";
}

/**
 * Thinking rendered as a first-class tool call — the exact same
 * expandable ToolRow card as every other tool (verb + muted inline
 * summary + spinner/check + chevron, detail below the divider).
 */
export function ThinkingToolUI({
  text,
  status,
  defaultOpen,
  children,
}: {
  text?: string;
  status?: { type?: string };
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  const running = status?.type === "running";
  const verb = verbFor(text ?? (typeof children === "string" ? children : ""));
  const summary =
    typeof text === "string" && text.trim()
      ? summaryFor(text, running)
      : running
        ? "…"
        : "";

  const detail =
    children ??
    (typeof text === "string" && text.trim() ? text : null);

  // Render the raw text via plain pre-wrap (same as the previous
  // ReasoningText path) — context-independent, no aui dependency.
  const body =
    children ??
    (typeof detail === "string" ? (
      <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
        {detail.slice(0, 8000)}
      </div>
    ) : null);

  if (!body) {
    return <ToolRow verb={verb} summary={summary} status={status} />;
  }

  return (
    <ToolRow
      verb={verb}
      summary={summary}
      status={status}
      defaultOpen={defaultOpen ?? running}
    >
      {body}
    </ToolRow>
  );
}

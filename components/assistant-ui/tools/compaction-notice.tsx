"use client";

import { makeAssistantDataUI, type DataMessagePartComponent } from "@assistant-ui/react";
import { parseCompactionData, formatCompactionNotice } from "@/lib/chat/compaction-notice";

/**
 * Inline notice for turns that ran on compacted context.
 *
 * The Pi harness writes a `data-compaction` part before the assistant
 * response whenever a fresh summary, hard cut, or overflow retry shrank
 * what the model saw. Rendering it here keeps compaction visible in the
 * thread (and in reloaded history — snapshots persist data parts) without
 * polluting the conversation text itself.
 */
const CompactionNotice: DataMessagePartComponent = ({ data }) => {
  const info = parseCompactionData(data);
  if (!info) return null;
  const text = formatCompactionNotice(info);
  return (
    <div
      data-slot="compaction-notice"
      title="Older chat history was condensed so this turn fits the model's context. Your full history is still saved on this device."
      className="my-1.5 flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
      <span>{text}</span>
    </div>
  );
};

export const CompactionNoticeDataUI = makeAssistantDataUI({
  name: "compaction",
  render: CompactionNotice,
});

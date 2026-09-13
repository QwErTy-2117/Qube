/**
 * Frontend tracking for context compaction.
 *
 * The Pi harness emits a `data-compaction` UI-stream part whenever a turn
 * runs on compacted context (fresh summary, hard cut, or overflow retry).
 * The transport converts it to a `{ type: "data", name: "compaction" }`
 * message part, and the registered DataUI renders the notice inline.
 *
 * These helpers are UI-framework-free so they can be unit-tested in node.
 */

export type CompactionNoticeInfo = {
  compacted: boolean;
  freshSummary: boolean;
  hardCut: boolean;
  retried: boolean;
  keptMessages?: number;
  droppedMessages?: number;
};

function finiteCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/** Normalize a raw `data-compaction` payload. Null when not a compaction event. */
export function parseCompactionData(data: unknown): CompactionNoticeInfo | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  // The harness always sends compacted:true; ignore anything else so
  // unrelated data parts never render a notice.
  if (d.compacted !== true && d.freshSummary !== true && d.hardCut !== true) return null;
  return {
    compacted: true,
    freshSummary: d.freshSummary === true,
    hardCut: d.hardCut === true,
    retried: d.retried === true,
    keptMessages: finiteCount(d.keptMessages),
    droppedMessages: finiteCount(d.droppedMessages),
  };
}

/** Plain-language, one-line notice for the chat UI. */
export function formatCompactionNotice(info: CompactionNoticeInfo): string {
  const counts =
    info.droppedMessages !== undefined && info.droppedMessages > 0
      ? ` — ${info.droppedMessages} older message${info.droppedMessages === 1 ? "" : "s"} summarized` +
        (info.keptMessages !== undefined ? `, ${info.keptMessages} recent kept` : "")
      : "";
  if (info.hardCut) {
    const dropped =
      info.droppedMessages !== undefined && info.droppedMessages > 0
        ? ` — ${info.droppedMessages} older message${info.droppedMessages === 1 ? "" : "s"} dropped`
        : " — older history dropped";
    return (
      `Context trimmed to fit${dropped}. ` +
      `If I seem to miss earlier details, just restate them.`
    );
  }
  const prefix = info.retried ? "Recovered from a full context — " : "";
  return `${prefix}Earlier chat condensed into a summary${counts}. Nothing you said was deleted.`;
}

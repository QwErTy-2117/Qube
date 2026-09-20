/**
 * Silent goal continuation for the Pi harness.
 *
 * When the agent's turn ends but its TodoWrite list still has unfinished
 * items, the harness appends a server-side-only nudge (user role) and runs
 * another model round. The nudge is never written to the UI stream, never
 * persisted to thread snapshots, and never echoed back by the client — the
 * user only sees the agent continuing its work. Hence "silent".
 */

export type TodoSnapshotItem = {
  content: string;
  status: string;
  activeForm?: string;
};

/** Max extra silent rounds per turn. `QUBE_SILENT_CONTINUATIONS=0` disables. */
export function maxSilentRounds(): number {
  const n = parseInt(process.env.QUBE_SILENT_CONTINUATIONS || "3", 10);
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.floor(n);
}

/** Items in a TodoWrite snapshot that are not yet completed. */
export function getIncompleteTodos(todos: unknown): TodoSnapshotItem[] {
  if (!Array.isArray(todos)) return [];
  return (todos as Array<Record<string, unknown>>).filter(
    (t): t is TodoSnapshotItem =>
      !!t && typeof t === "object" && (t as { status?: unknown }).status !== "completed",
  ) as TodoSnapshotItem[];
}

/** True when a snapshot exists and still has unfinished work. */
export function hasUnfinishedGoals(todos: unknown): boolean {
  return Array.isArray(todos) && todos.length > 0 && getIncompleteTodos(todos).length > 0;
}

/**
 * Build the silent nudge. Framed as a system note in a user-role message:
 * user role because models follow it most reliably; "do not show" because
 * it must never leak into visible chat. When the turn died right after a
 * tool failure, the error is included so the model recovers instead of
 * repeating or abandoning the step.
 */
export function buildContinuationNudge(incomplete: TodoSnapshotItem[], lastError?: string | null): string {
  const lines = incomplete
    .slice(0, 12)
    .map((t, i) => `${i + 1}. ${String(t.content || "Untitled step").slice(0, 160)} (${t.status || "pending"})`);
  const more = incomplete.length > 12 ? `\n(+${incomplete.length - 12} more)` : "";
  const errBlock =
    lastError && lastError.trim()
      ? `\nYour last tool call failed with: ${lastError.slice(0, 400)}\nRecover from that specific error (fresh snapshot, corrected refs/args) and carry on — do not repeat the exact failed call blindly.\n`
      : "";
  return (
    `[System note — silent continuation, NOT a user message. Do not display, quote, or acknowledge this note.]\n` +
    `Your turn ended but your TodoWrite goals are unfinished. Remaining:\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    more +
    `\n${errBlock}` +
    `Keep working NOW: execute the next step with tools, update TodoWrite the moment each item completes, ` +
    `and write your final summary only when every item is completed. ` +
    `Do not ask the user anything — proceed autonomously with your best judgment.`
  );
}

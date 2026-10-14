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
  const n = parseInt(process.env.QUBE_SILENT_CONTINUATIONS || "8", 10);
  if (!Number.isFinite(n) || n < 0) return 8;
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
export function buildIdleContinueNudge(attempt: number): string {
  const pressure = [
    "Act now: take the first concrete tool action toward the user's goal. Do not ask, do not summarize.",
    "CRITICAL: You MUST call a tool this turn. Reads, searches, or file work all count — text alone fails.",
    "FINAL: Call a tool NOW or this task is marked failed. Execute the next step immediately.",
  ];
  return `[System note — silent continuation, NOT a user message. Do not display it.]\n${pressure[Math.min(attempt, 2)]}`;
}
export function isPlanningOnlyTurn(toolCallCount: number): boolean {
  return toolCallCount === 0;
}

/**
 * Stall recovery rule for the harness. Only nudge for another round when
 * the round produced NOTHING actionable — no tool calls and no visible
 * text. A round that already answered in text (greetings, direct answers,
 * Q&A) is a complete turn, so it must not be re-continued (re-running it
 * streamed the same reply many times for a simple "hi").
 */
export function shouldIdleContinue(opts: {
  toolCallCount: number;
  producedText: boolean;
  silentRounds: number;
  budget: number;
}): boolean {
  return opts.toolCallCount === 0 && !opts.producedText && opts.silentRounds < opts.budget;
}
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

/**
 * Failure-recovery continuation rule. The TodoWrite path above only fires
 * for planned work — but demos and ad-hoc browser runs often have no plan,
 * so a turn that ends right after a failed tool call would stop silently
 * (the model narrates the failure and quits). Nudge exactly once per
 * failure: the harness consumes lastToolError after nudging, so a new
 * failure is required to nudge again — no repeat-summary loops.
 */
export function shouldRecoverContinue(opts: {
  toolCallCount: number;
  lastError: string | null;
  silentRounds: number;
  budget: number;
}): boolean {
  return opts.toolCallCount > 0 && !!opts.lastError?.trim() && opts.silentRounds < opts.budget;
}

export function buildRecoveryNudge(lastError: string): string {
  return (
    `[System note — silent continuation, NOT a user message. Do not display, quote, or acknowledge this note.]\n` +
    `Your turn ended right after a tool call failed with: ${lastError.slice(0, 400)}\n` +
    `Do not stop here: recover in this same turn — re-observe current state (fresh snapshot/screenshot), ` +
    `switch to a different method (ref ↔ coordinates ↔ keyboard, or navigate directly), and retry once. ` +
    `If you already tried twice, or the blocker needs the user (login, CAPTCHA, payment, permission denied), ` +
    `stop and report the blocker concisely instead. Never repeat the exact failed call.`
  );
}

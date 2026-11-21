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
  // Keep a hard ceiling: a typo or an over-optimistic value must not turn the
  // continuation loop into an unbounded one.
  return Math.min(Math.floor(n), 100);
}

/**
 * Max goal-driven continuation rounds per turn. Separate from the stall /
 * failure-recovery budget above: a planned task with open TodoWrite items is
 * expected to take many more rounds than a one-shot nudge, and the old shared
 * 8-round cap is what made long runs stop with goals still open.
 * `QUBE_GOAL_CONTINUATIONS=0` disables goal continuation.
 */
export function maxGoalRounds(): number {
  const n = parseInt(process.env.QUBE_GOAL_CONTINUATIONS || "30", 10);
  if (!Number.isFinite(n) || n < 0) return 30;
  // Hard ceiling: still bounded, just far above the old shared budget.
  return Math.min(Math.floor(n), 500);
}

/**
 * Rounds granted to a plan INHERITED from earlier turns. Kept small: an old
 * checklist may be abandoned work, so it gets a few rounds to either continue
 * (by re-writing TodoWrite, which makes it a fresh plan) or be cancelled.
 */
export function maxInheritedGoalRounds(): number {
  const n = parseInt(process.env.QUBE_GOAL_INHERITED_ROUNDS || "5", 10);
  if (!Number.isFinite(n) || n < 0) return 5;
  return Math.min(Math.floor(n), 50);
}

/**
 * Consecutive goal rounds allowed without progress (no new completed item and
 * no successful tool call). Prevents an infinite loop when a goal is blocked
 * (needs a login, missing permission, dead URL) but the model keeps trying.
 */
export function maxStalledGoalRounds(): number {
  const n = parseInt(process.env.QUBE_GOAL_STALL_ROUNDS || "3", 10);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(Math.floor(n), 20);
}

/**
 * Consecutive rounds that surfaced a provider/stream error but are still
 * allowed to continue while goals remain open. A single transient error must
 * not abandon the plan; a persistent one must not loop forever.
 */
export function maxGoalErrorRounds(): number {
  const n = parseInt(process.env.QUBE_GOAL_ERROR_ROUNDS || "2", 10);
  if (!Number.isFinite(n) || n < 0) return 2;
  return Math.min(Math.floor(n), 10);
}

/**
 * Progress signal for the goal loop: completed-item count plus successful
 * tool calls. Either one advancing proves the round did real work. A round
 * that only retries failing calls changes neither and counts as stalled.
 */
export function goalProgressSignature(todos: unknown, successfulToolCalls: number): string {
  const list = Array.isArray(todos) ? (todos as Array<Record<string, unknown>>) : [];
  const done = list.filter((t) => t && typeof t === "object" && t.status === "completed").length;
  const calls = Number.isFinite(successfulToolCalls) ? Math.max(0, Math.floor(successfulToolCalls)) : 0;
  return `${done}/${list.length}:${calls}`;
}

export type GoalContinueInput = {
  hasUnfinished: boolean;
  rounds: number;
  budget: number;
  stalledRounds: number;
  stallLimit: number;
  consecutiveErrors: number;
  errorLimit: number;
  aborted: boolean;
  /**
   * Whether this run has actually worked (tool calls or a fresh TodoWrite).
   * A plan recovered from chat history is only inherited when the run is
   * genuinely working on something — a plain answer ("hi") must not restart
   * an old, possibly abandoned, checklist.
   */
  hasRunWork?: boolean;
};

/**
 * Decide whether another round should run because TodoWrite goals are open.
 * Distinct from shouldIdleContinue: a visible answer does NOT end the turn
 * while items remain unfinished; only completion, the budget, repeated
 * zero-progress rounds, repeated errors, or cancellation stop it.
 */
export function shouldContinueGoals(opts: GoalContinueInput): boolean {
  if (opts.aborted || !opts.hasUnfinished) return false;
  if (opts.hasRunWork === false) return false;
  if (opts.rounds >= opts.budget) return false;
  if (opts.stalledRounds >= Math.max(1, opts.stallLimit)) return false;
  if (opts.consecutiveErrors > Math.max(0, opts.errorLimit)) return false;
  return true;
}

function todoListFrom(input: unknown): TodoSnapshotItem[] | null {
  const args = input as { todos?: unknown } | null | undefined;
  if (!args || typeof args !== "object") return null;
  if (!Array.isArray(args.todos)) return null;
  return args.todos as TodoSnapshotItem[];
}

/**
 * Recover the most recent TodoWrite snapshot from the visible conversation.
 *
 * Goal continuation used to depend on the model re-calling TodoWrite in the
 * current run. A plan created in an earlier turn (the user's goals panel still
 * showing open items) therefore had no in-run snapshot and the agent stopped
 * mid-goal. Seeding from history closes that hole for chat, ACP and any caller
 * that passes prior UIMessages.
 */
export function findLastTodoSnapshot(messages: unknown): TodoSnapshotItem[] | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Record<string, unknown> | null;
    if (!message || typeof message !== "object") continue;
    const parts = Array.isArray((message as any).parts)
      ? ((message as any).parts as unknown[])
      : Array.isArray((message as any).content)
        ? ((message as any).content as unknown[])
        : [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as Record<string, any> | null;
      if (!part || typeof part !== "object") continue;
      const type = typeof part.type === "string" ? part.type : "";
      const isToolCall =
        type === "tool-call" ||
        type === "dynamic-tool" ||
        type === "dynamic-tool-call" ||
        type === "tool_call" ||
        /^tool-[A-Za-z0-9_]/.test(type) ||
        // Generic tool part that carries a name + input regardless of the
        // exact wire label ("tool", "tool-invocation", provider variants).
        (typeof part.toolName === "string" && (part.input ?? part.args ?? part.arguments) !== undefined);
      if (!isToolCall) continue;
      const name =
        typeof part.toolName === "string"
          ? part.toolName
          : typeof part.name === "string"
            ? part.name
            : /^tool-/.test(type)
              ? type.slice(5)
              : "";
      if (name !== "TodoWrite") continue;
      const list = todoListFrom(part.input ?? part.args ?? part.arguments ?? part.toolInput);
      if (list) return list;
    }
  }
  return null;
}

/** Items in a TodoWrite snapshot that are not yet completed. */
export function getIncompleteTodos(todos: unknown): TodoSnapshotItem[] {
  if (!Array.isArray(todos)) return [];
  return (todos as Array<Record<string, unknown>>).filter(
    (t): t is TodoSnapshotItem =>
      !!t &&
      typeof t === "object" &&
      // `cancelled` is terminal too: the plan intentionally dropped the item,
      // so treating it as open would keep the agent working forever on work
      // nobody wants anymore.
      (t as { status?: unknown }).status !== "completed" &&
      (t as { status?: unknown }).status !== "cancelled",
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
export function buildContinuationNudge(
  incomplete: TodoSnapshotItem[],
  lastError?: string | null,
  opts?: { inherited?: boolean },
): string {
  const lines = incomplete
    .slice(0, 12)
    .map((t, i) => `${i + 1}. ${String(t.content || "Untitled step").slice(0, 160)} (${t.status || "pending"})`);
  const more = incomplete.length > 12 ? `\n(+${incomplete.length - 12} more)` : "";
  const errBlock =
    lastError && lastError.trim()
      ? `\nYour last tool call failed with: ${lastError.slice(0, 400)}\nRecover from that specific error (fresh snapshot, corrected refs/args) and carry on — do not repeat the exact failed call blindly.\n`
      : "";
  // An inherited checklist (created in an earlier turn) may no longer be the
  // current task. Say so explicitly and let the model close it honestly
  // instead of silently reviving abandoned work turn after turn.
  const framing = opts?.inherited
    ? `This thread has an unfinished TodoWrite checklist from earlier. If those items are still the user's current task, keep working on them now. ` +
      `If the user has moved on or the work was abandoned, let the user know in one line and stop — do not revive old work. Remaining:\n`
    : `Your turn ended but your TodoWrite goals are unfinished. Remaining:\n`;
  return (
    `[System note — silent continuation, NOT a user message. Do not display, quote, or acknowledge this note.]\n` +
    framing +
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

/**
 * Extract a continuation-worthy error from a tool result, or null when the
 * result is clean (a clean result supersedes any earlier failure — the
 * caller assigns the return directly to lastToolError).
 *
 * Covers every result shape in the system: MCP isError objects, "error:"
 * text, Pi JSON errors ({"error":true}), explicit failures ({"ok":false}),
 * and the kernel's own gates ({"blocked":"repeat_failure"},
 * {"error":"Operation not permitted"}). The last two matter: without them a
 * blocked repeat or a denied action looks like SUCCESS and no recovery
 * continuation ever fires for it.
 */
export function extractToolError(toolName: string, out: unknown): string | null {
  try {
    if (out && typeof out === "object") {
      const o = out as { isError?: unknown; content?: unknown };
      if (o.isError === true) {
        try {
          const parts = o.content;
          const text = Array.isArray(parts)
            ? parts.map((p: unknown) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? String((p as { text: unknown }).text) : "")).join(" ").trim()
            : "";
          return `${toolName}: ${(text || JSON.stringify(out)).slice(0, 400)}`;
        } catch {
          return `${toolName}: tool reported an error`;
        }
      }
      return null;
    }
    if (typeof out !== "string") return null;
    const t = out.trim();
    if (/^error:/i.test(t)) return `${toolName}: ${t.slice(0, 400)}`;
    let parsed: any = null;
    try {
      parsed = JSON.parse(t);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.blocked === "string" && parsed.blocked) {
        return `${toolName}: blocked (${parsed.blocked}): ${String(parsed.message || "").slice(0, 300)}`;
      }
      if (parsed.ok === false || parsed.error === true) {
        return `${toolName}: ${String(parsed.message || parsed.error || t).slice(0, 300)}`;
      }
      // Any other non-empty string error marks failure — tools only set a
      // top-level string `error` when the call did not succeed (explicit
      // ok:true wins, so honest success payloads stay clean).
      if (typeof parsed.error === "string" && parsed.error.trim() && parsed.ok !== true) {
        return `${toolName}: ${parsed.error.trim().slice(0, 300)}`;
      }
      return null;
    }
    // Truncated JSON (tools slice long outputs): the error flag may survive
    // even when the payload no longer parses — preserve the old fallback.
    if (/"\s*error\s*"\s*:\s*true/.test(t.slice(0, 600))) return `${toolName}: ${t.slice(0, 400)}`;
    return null;
  } catch {
    return null;
  }
}

export function buildRecoveryNudge(lastError: string): string {
  return (
    `[System note — silent continuation, NOT a user message. Do not display, quote, or acknowledge this note.]\n` +
    `Your turn ended right after a tool call failed with: ${lastError.slice(0, 400)}\n` +
    `Do not stop here: recover in this same turn — re-observe current state (fresh snapshot/screenshot), ` +
    `switch to a different method (ref ↔ coordinates ↔ keyboard, or navigate directly), and retry once. ` +
    `If you already tried twice, if the blocker needs the user (login, 2FA, permission denied), ` +
    `or if the error says the target is Blocked (policy block — retrying the same URL/action cannot succeed), ` +
    `stop and report the blocker concisely instead. Never repeat the exact failed call.`
  );
}

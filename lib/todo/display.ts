/**
 * Shared display helpers for the home to-do widget.
 *
 * The widget mixes heartbeat ledger work, manual reminders and today's
 * scheduled occurrences. Persisted source text can carry bookkeeping markers
 * (for example the `[manual-task:<id>]` link that binds a reminder to its
 * task); those are useful to the scheduler but must never leak into the UI.
 */

export type TodoOrderItem = {
  id: string;
  done: boolean;
};

const TITLE_PREFIXES: RegExp[] = [
  /^\s*\[manual-task:[^\]]+\]\s*/i,
  /^\s*\[heartbeat[^\]]*\]\s*/i,
  /^\s*heartbeat\s+reminder\s*:\s*/i,
  /^\s*heartbeat\s*:\s*/i,
  /^\s*scheduled\s+task\s*:\s*/i,
  /^\s*scheduled\s*:\s*/i,
  /^\s*reminder\s*:\s*/i,
  /^\s*task\s*:\s*/i,
];

/**
 * Strip scheduler bookkeeping prefixes from a user-visible task title.
 * Repeated prefixes are removed, and empty results fall back to a stable
 * label so rows never render blank.
 */
export function cleanTaskTitle(raw: unknown): string {
  let title = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();

  let previous = "";
  while (title && title !== previous) {
    previous = title;
    for (const prefix of TITLE_PREFIXES) {
      title = title.replace(prefix, "").trim();
    }
  }

  return title || "Untitled task";
}

function stableHash(seed: number, id: string): number {
  let hash = 0x811c9dc5 ^ (Math.trunc(seed) >>> 0);
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Randomized but seed-stable ordering for the home checklist.
 *
 * Requirements that shape this order:
 * - completed items sit at the top;
 * - an unfinished item is visible at first glance (in the first five);
 * - at least one completed item is in the first five whenever one exists.
 *
 * The first unfinished item is therefore spliced just below the first two
 * completed rows instead of leaving a wall of completed items on top. The
 * remaining unfinished rows follow. A fixed seed keeps the order from
 * reshuffling every 30-second poll.
 */
export function orderTodoItems<T extends TodoOrderItem>(
  items: readonly T[],
  seed = 0,
): T[] {
  const byStableRandom = (a: T, b: T) =>
    stableHash(seed, a.id) - stableHash(seed, b.id);

  const done = items.filter((item) => item.done).sort(byStableRandom);
  const open = items.filter((item) => !item.done).sort(byStableRandom);

  if (done.length === 0) return open;
  if (open.length === 0) return done;

  const ordered = [...done];
  const [firstOpen, ...remainingOpen] = open;
  ordered.splice(Math.min(2, ordered.length), 0, firstOpen);
  ordered.push(...remainingOpen);
  return ordered;
}

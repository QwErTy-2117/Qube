/**
 * Bounded execution limits.
 *
 * Every loop in the harness must have a hard ceiling that cannot be removed by
 * a malformed or overly optimistic environment variable. These helpers are
 * deliberately small and pure so the limits can be unit-tested without
 * starting a model run.
 */

/** Parse an integer env var, falling back when absent/invalid, then clamp. */
export function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(raw || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/** Model/tool steps inside one streamText round. */
export function maxStepsPerRound(raw = process.env.PI_HARNESS_MAX_STEPS): number {
  return boundedInt(raw, 60, 1, 500);
}

/** Extra rounds allowed to repair a failed completion verification. */
export function maxVerificationRounds(raw = process.env.QUBE_VERIFICATION_ROUNDS): number {
  return boundedInt(raw, 2, 0, 10);
}

/** Concurrent foreground runs. */
export function maxConcurrentRuns(raw = process.env.PI_MAX_CONCURRENT_RUNS): number {
  return boundedInt(raw, 32, 1, 128);
}

/**
 * Hard ceiling on outer harness rounds: initial + overflow retry + silent
 * continuations + verification retries + slack. Kept dependent on the two
 * configurable budgets so raising one still has a finite bound.
 */
export function computeRoundLimit(silentBudget: number, verificationBudget: number): number {
  const safe = (value: number, max: number): number => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(n, 0), max);
  };
  return safe(silentBudget, 100) + safe(verificationBudget, 10) + 8;
}

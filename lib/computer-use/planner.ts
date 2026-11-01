/**
 * ActionPlanner: run-level replan policy for the kernel pipeline.
 *
 * The repeat guard handles one action failing over and over (stuck on a
 * signature). This module watches the run as a whole and distinguishes
 * stuck (same action failing) from flailing (many DIFFERENT actions
 * failing in a row) so the steer tells the model the right thing: switch
 * methods vs step back and replan from the goal. Pure and unit-tested;
 * the executor calls assessReplan instead of inlining the threshold.
 */

export type RunMode = "progressing" | "stuck" | "flailing";

export interface ReplanAssessment {
  mode: RunMode;
  /** Steer hint for the model, or null when no intervention is needed. */
  steer: string | null;
}

export const REPLAN_AFTER_CONSECUTIVE_FAILURES = 3;
export const FLAIL_DISTINCT_THRESHOLD = 3;

export function assessReplan(opts: {
  consecutiveFailures: number;
  distinctFailedSignatures: number;
}): ReplanAssessment {
  if (opts.consecutiveFailures < REPLAN_AFTER_CONSECUTIVE_FAILURES) {
    return { mode: "progressing", steer: null };
  }
  if (opts.distinctFailedSignatures >= FLAIL_DISTINCT_THRESHOLD) {
    return {
      mode: "flailing",
      steer:
        "STOP flailing: several DIFFERENT approaches just failed in a row — this page/task is not yielding to maneuvers. " +
        "Do not try another variation of the same idea. Step back: re-read the goal, re-observe with a fresh snapshot, " +
        "and either pick a fundamentally different route (direct URL, different tab, different tool family) or report the blocker and ask the user.",
    };
  }
  return {
    mode: "stuck",
    steer:
      "STOP: 3+ consecutive failures — re-read the goal, re-observe the page with a fresh snapshot, update the plan, " +
      "and try a different approach or ask the user.",
  };
}

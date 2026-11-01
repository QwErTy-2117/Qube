import type { RecoveryPlan, Verification } from "./types";

export function planRecovery(v: Verification, opts?: { failures?: number }): RecoveryPlan {
  const hints: string[] = [];
  const s = v.signals;
  const n = opts?.failures ?? 1;
  if (s.includes("captcha")) {
    hints.push("CAPTCHA/anti-bot challenge detected — do NOT try to solve or bypass it. Call request_takeover so the user can handle it, or stop and report.");
    return { autoSteps: [], hints };
  }
  if (s.includes("auth_wall")) {
    hints.push("A login/auth wall appeared — do NOT guess credentials. Call request_takeover for the user to sign in, or stop and report.");
    return { autoSteps: [], hints };
  }
  if (s.includes("stale_ref")) {
    hints.push("Stale element ref — take a fresh browser_snapshot and retry with the NEW refs in this same turn; do not reuse old refs.");
    return { autoSteps: ["resnapshot"], hints };
  }
  if (s.includes("crash")) {
    hints.push("Browser connection lost — restarting it once with tabs restored, then re-navigate to the page and re-snapshot; do NOT replay the failed action blindly.");
    return { autoSteps: ["restart_browser"], hints };
  }
  if (s.includes("new_dialog")) {
    hints.push("A dialog appeared — snapshot/screenshot to read it, then dismiss or answer it deliberately based on the task. Never auto-confirm destructive dialogs.");
    return { autoSteps: ["resnapshot"], hints };
  }
  if (s.includes("disabled")) {
    hints.push("Target control is disabled or obscured — check prerequisites (required fields, scroll into view, close overlays) before retrying. Do not click repeatedly.");
    return { autoSteps: [], hints };
  }
  if (s.includes("nav_failed") || s.includes("error_text")) {
    hints.push(n >= 2 ? "Navigation/action failed twice — verify the URL, then try a different approach instead of repeating." : "Navigation/action failed — verify the URL or page state, then retry once with a fresh snapshot.");
    return { autoSteps: [], hints };
  }
  if (v.verdict === "no_effect") {
    hints.push(n >= 2
      ? `No page change after ${n} attempts — STOP repeating this action. Re-snapshot, verify the control exists and is enabled, then switch methods (ref ↔ coordinates ↔ keyboard).`
      : "No page change detected — re-snapshot to confirm state before retrying; if the control is missing, switch methods (ref ↔ coordinates ↔ keyboard).");
    return { autoSteps: [], hints };
  }
  return { autoSteps: [], hints };
}

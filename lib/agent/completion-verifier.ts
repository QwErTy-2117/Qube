/**
 * Completion verification gate.
 *
 * The harness already nudges when TodoWrite is unfinished. That still trusts
 * the model's own bookkeeping. This verifier adds independent, machine-checkable
 * evidence before a task is treated as complete:
 *
 *  - every todo is completed
 *  - the last tool call did not fail
 *  - at least one tool call succeeded when tools were used
 *  - every file the model claims to have written still exists on disk
 *
 * It is intentionally conservative: read-only Q&A turns are "not checked"
 * (and therefore not blocked). Work that used tools, wrote files, or created
 * todos must pass before the harness stops nudging and before completion is
 * recorded in the execution ledger.
 */

import { stat } from "node:fs/promises";

export type VerifyTodo = { content?: string; status?: string };

export type VerificationInput = {
  todos?: VerifyTodo[] | null;
  toolCalls: number;
  successfulToolCalls: number;
  producedText: boolean;
  sawError: boolean;
  lastToolError?: string | null;
  filesTouched?: string[];
  evidence?: Array<{ kind: string; detail: string }>;
  maxFileChecks?: number;
};

export type VerificationResult = {
  /** False for conversational turns where no verification is meaningful. */
  checked: boolean;
  complete: boolean;
  reasons: string[];
  evidence: string[];
};

export async function verifyCompletion(input: VerificationInput): Promise<VerificationResult> {
  const todos = Array.isArray(input.todos) ? input.todos : [];
  const files = Array.from(new Set((input.filesTouched || []).filter(Boolean)));
  const hasWorkSignals =
    todos.length > 0 ||
    input.toolCalls > 0 ||
    files.length > 0 ||
    (input.evidence || []).length > 0 ||
    !!input.lastToolError;

  if (!hasWorkSignals) {
    return { checked: false, complete: true, reasons: [], evidence: [] };
  }

  const reasons: string[] = [];
  const evidence: string[] = [];

  const incomplete = todos.filter((t) => t?.status !== "completed");
  if (incomplete.length > 0) {
    const names = incomplete.slice(0, 6).map((t) => String(t?.content || "untitled")).join("; ");
    reasons.push(`${incomplete.length} todo item(s) still unfinished: ${names}`);
  } else if (todos.length > 0) {
    evidence.push(`all ${todos.length} todo item(s) completed`);
  }

  if (input.sawError) reasons.push("the turn surfaced an error");
  if (input.lastToolError?.trim()) reasons.push(`last tool failure is unresolved: ${input.lastToolError.slice(0, 240)}`);
  if (!input.producedText) reasons.push("no final text was produced");
  if (input.toolCalls > 0 && input.successfulToolCalls === 0) {
    reasons.push("no tool call completed successfully");
  } else if (input.successfulToolCalls > 0) {
    evidence.push(`${input.successfulToolCalls}/${input.toolCalls} tool call(s) succeeded`);
  }

  const maxChecks = Math.min(Math.max(input.maxFileChecks ?? 20, 1), 50);
  for (const path of files.slice(0, maxChecks)) {
    try {
      const s = await stat(path);
      if (s.isFile()) evidence.push(`file exists: ${path} (${s.size} bytes)`);
      else reasons.push(`expected a file but found another kind of entry: ${path}`);
    } catch {
      reasons.push(`claimed output is missing on disk: ${path}`);
    }
  }
  if (files.length > maxChecks) {
    evidence.push(`verified the first ${maxChecks} of ${files.length} touched files`);
  }

  return {
    checked: true,
    complete: reasons.length === 0,
    reasons,
    evidence,
  };
}

/** Silent continuation note used when verification fails before the budget runs out. */
export function buildVerificationNudge(result: VerificationResult): string {
  const reasons = result.reasons.slice(0, 8).map((r) => `- ${r}`).join("\n");
  return (
    `[System note — completion verification, NOT a user message. Do not display, quote, or acknowledge this note.]\n` +
    `The completion check failed. Unverified claims:\n${reasons}\n\n` +
    `Fix them with tools NOW: run the missing step, re-check the file/output, and update TodoWrite honestly. ` +
    `Do not claim completion until the verification passes. If something is truly impossible, state exactly what remains and why.`
  );
}

/** One short user-visible line for a task that remains unverified after retries. */
export function formatUnverifiedNote(result: VerificationResult): string {
  const why = result.reasons.slice(0, 3).join("; ");
  return `Verification note: I could not fully verify completion (${why}). Treat the result as partial.`;
}

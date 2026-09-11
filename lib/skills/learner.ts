/**
 * Skill learner — self-created reusable procedures (§§10-14).
 *
 * A memory answers "what do I know?"; a skill answers "what procedure
 * should I follow?". Skills are created only when reusable, procedural,
 * understood, likely to recur, and able to improve future performance.
 *
 * Lifecycle: candidate -> tested -> trusted -> deprecated.
 * A candidate comes from one success; trusted needs repeated success or
 * strong validation. Failures diagnose and update rather than loop.
 *
 * All logic here is deterministic and general-purpose: no hardcoded
 * website/error/topic rules. Specificity is measured structurally
 * (URLs, exact UI labels, exact errors, single datasets).
 */

export type LearnedSkillStatus = "candidate" | "tested" | "trusted" | "deprecated";

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  whenToUse: string;
  preconditions: string[];
  failureModes: string[];
  recoverySteps: string[];
  validation: string;
  scope: string;
  scopeKey?: string;
  confidence: number;
  provenance: string;
}

export interface SkillEvaluation {
  reusable: boolean;
  procedural: boolean;
  understood: boolean;
  likelyToRecur: boolean;
  improvesPerformance: boolean;
  saferWhenConsistent: boolean;
  score: number;
  shouldCreate: boolean;
  reasons: string[];
}

export interface SkillUseRecord {
  skillName: string;
  success: boolean;
  contextChanged: boolean;
  error?: string;
}

/** Creation criteria (§11): all signals scored, threshold for candidate. */
export function evaluateSkillCreation(opts: {
  occurrences: number;
  stepsCount: number;
  hadRecovery: boolean;
  validated: boolean;
  recurrenceLikelihood: number; // 0-1
  generalizable: boolean;
  timesSavedMinutes?: number;
}): SkillEvaluation {
  const reasons: string[] = [];
  const reusable = opts.occurrences >= 1 && opts.recurrenceLikelihood >= 0.4;
  const procedural = opts.stepsCount >= 2;
  const understood = opts.validated || opts.hadRecovery;
  const likelyToRecur = opts.recurrenceLikelihood >= 0.5 || opts.occurrences >= 2;
  const improvesPerformance = (opts.timesSavedMinutes ?? 0) >= 2 || opts.hadRecovery || opts.stepsCount >= 3;
  const saferWhenConsistent = opts.hadRecovery || opts.stepsCount >= 4;

  let score = 0;
  if (reusable) score += 2; else reasons.push("not reusable yet");
  if (procedural) score += 2; else reasons.push("not procedural (single step)");
  if (understood) score += 1; else reasons.push("not sufficiently understood");
  if (likelyToRecur) score += 2; else reasons.push("unlikely to recur");
  if (improvesPerformance) score += 1; else reasons.push("no clear performance gain");
  if (saferWhenConsistent) score += 1;
  if (!opts.generalizable) {
    score -= 2;
    reasons.push("too instance-specific to generalize");
  }

  const shouldCreate = score >= 5 && reusable && procedural && opts.generalizable;
  if (shouldCreate) reasons.push(`candidate skill justified (score ${score}/9)`);
  return { reusable, procedural, understood, likelyToRecur, improvesPerformance, saferWhenConsistent, score, shouldCreate, reasons };
}

const SPECIFICITY_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s]+/,
  /\bclick\b.{0,20}["'][^"']+["']/i,
  /\bbutton\s+[A-Z][a-z]*\b/,
  /\berror\s+[A-Z0-9_-]{4,}/,
  /\b(url|dataset|file)\s*[:=]\s*["']?[\w\-./]{8,}["']?/i,
];

/** Specificity 0-1: 1 = tied to one instance. Skills must generalize (§12). */
export function skillSpecificity(instructions: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let hits = 0;
  const checks: Array<[RegExp, string]> = [
    [SPECIFICITY_PATTERNS[0], "hardcoded URL"],
    [SPECIFICITY_PATTERNS[1], "exact UI label"],
    [SPECIFICITY_PATTERNS[2], "exact button"],
    [SPECIFICITY_PATTERNS[3], "exact error code"],
    [SPECIFICITY_PATTERNS[4], "exact dataset/file"],
  ];
  for (const [re, label] of checks) {
    if (re.test(instructions)) {
      hits++;
      flags.push(label);
    }
  }
  // Short instructions that name one site/tool without abstraction are specific.
  const words = instructions.split(/\s+/).length;
  if (words < 40 && /^(for|when|on)\s+\S+\s*,?\s*(click|open|go to)/i.test(instructions.trim())) {
    hits++;
    flags.push("single-site procedure without abstraction");
  }
  return { score: Math.min(1, hits / 3), flags };
}

export function isGeneralizableSkill(instructions: string): boolean {
  const { score } = skillSpecificity(instructions);
  // Generalizable when it states a strategy + applicability, not just steps.
  const hasStrategy = /\b(first|identify|inspect|prefer|when|if|adapt|rather than|instead of|validate)\b/i.test(instructions);
  return score < 0.67 && (hasStrategy || instructions.split(/\s+/).length >= 60);
}

/** Validate a skill draft structurally (name/description/procedure/validation). */
export function validateSkillDraft(d: Partial<SkillDraft>): string | null {
  if (!d.name || !/^[a-z0-9-]{2,64}$/.test(d.name.trim())) return "name must be lowercase letters/numbers/hyphens (2-64)";
  if (!d.description || d.description.trim().length < 20) return "description must state what it does + when to use it (≥20 chars)";
  if (!d.instructions || d.instructions.trim().split(/\s+/).length < 30) return "instructions need a real procedure (≥30 words)";
  if (!d.whenToUse || d.whenToUse.trim().length < 10) return "whenToUse is required";
  if (!isGeneralizableSkill(d.instructions)) {
    const { flags } = skillSpecificity(d.instructions);
    return `too instance-specific (${flags.join(", ") || "no abstraction"}); extract the reusable strategy`;
  }
  return null;
}

/** Lifecycle transitions (§13): success strengthens, failure diagnoses. */
export function nextSkillStatus(
  current: LearnedSkillStatus,
  record: SkillUseRecord,
): { next: LearnedSkillStatus; note: string } {
  if (current === "deprecated") return { next: "deprecated", note: "deprecated skills stay deprecated unless explicitly revived" };
  if (!record.success) {
    if (record.contextChanged) {
      // Misapplied, not wrong: keep status, narrow scope.
      return { next: current, note: "failure from changed context — narrow scope, do not demote" };
    }
    if (current === "trusted") return { next: "tested", note: "trusted skill failed — demote to tested pending fix" };
    if (current === "tested") return { next: "candidate", note: "repeated failure — back to candidate for revision" };
    return { next: "candidate", note: "candidate failed — revise procedure before reuse" };
  }
  // Success path.
  if (current === "candidate") return { next: "tested", note: "second success — promote to tested" };
  if (current === "tested") return { next: "trusted", note: "repeated success — promote to trusted" };
  return { next: "trusted", note: "trusted skill succeeded again" };
}

/** Normalize a draft into store-ready fields (compatible with SkillConfig). */
export function draftToSkillConfig(d: SkillDraft): {
  name: string;
  description: string;
  instructions: string;
  allowedTools?: string;
} {
  const body = [
    `## Purpose\n${d.description.trim()}`,
    ``,
    `## When to use\n${d.whenToUse.trim()}`,
    ...(d.preconditions.length ? [``, `## Preconditions`, ...d.preconditions.map((p) => `- ${p}`)] : []),
    ``,
    `## Procedure`,
    d.instructions.trim(),
    ...(d.failureModes.length ? [``, `## Failure modes`, ...d.failureModes.map((f) => `- ${f}`)] : []),
    ...(d.recoverySteps.length ? [``, `## Recovery`, ...d.recoverySteps.map((r) => `- ${r}`)] : []),
    ``,
    `## Validation`,
    d.validation.trim(),
    ``,
    `<!-- scope: ${d.scope}${d.scopeKey ? `:${d.scopeKey}` : ""} | confidence: ${d.confidence} | provenance: ${d.provenance} -->`,
  ].join("\n");
  return { name: d.name.trim().toLowerCase(), description: d.description.trim(), instructions: body };
}

export type ActionDomain = "browser" | "desktop" | "terminal" | "file" | "other";
export type ActionKind = "observe" | "interact" | "navigate" | "input" | "exec" | "meta";
export type RiskLevel = "read" | "interact" | "external" | "financial" | "destructive" | "account" | "credential";
export type Verdict = "verified" | "no_effect" | "failed" | "unknown" | "blocked" | "denied";

export interface ActionDescriptor {
  tool: string;
  domain: ActionDomain;
  kind: ActionKind;
  mutating: boolean;
  refs: string[];
  points: Array<{ x: number; y: number }>;
  typed: string[];
  keys: string[];
  urls: string[];
  targetText: string;
  summary: string;
}

export interface PageFingerprint {
  at: number;
  url: string;
  title: string;
  textHash: string;
  textLen: number;
  dialog: boolean;
  /** Focused element description ("role \"name\"") for key-press targeting. Optional: older fingerprints lack it. */
  focus?: string | null;
  /** Hash of form control values (passwords masked) — typing/fill detection. Optional. */
  formHash?: string | null;
  /** Vertical scroll offset (px) — scroll verification. Optional. */
  scrollY?: number | null;
}

export interface Verification {
  verdict: Exclude<Verdict, "blocked" | "denied">;
  changed: boolean;
  signals: string[];
}

export interface RecoveryPlan {
  autoSteps: Array<"resnapshot" | "restart_browser">;
  hints: string[];
}

export interface KernelSummary {
  id: string;
  risk: RiskLevel;
  verdict: Verdict;
  changed?: boolean;
  signals?: string[];
  hints?: string[];
  blocked?: boolean;
  repeat?: boolean;
  /** Recovery auto-steps the kernel itself executed (not just suggested). */
  recovered?: string[];
  /** Condensed page console/network errors captured with this action. */
  pageErrors?: string[];
}

export interface KernelOptions {
  threadId: string;
  interactive: boolean;
}

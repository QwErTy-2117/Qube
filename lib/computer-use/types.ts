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
}

export interface Verification {
  verdict: Exclude<Verdict, "blocked" | "denied">;
  changed: boolean;
  signals: string[];
}

export interface RecoveryPlan {
  autoSteps: Array<"resnapshot">;
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
}

export interface KernelOptions {
  threadId: string;
  interactive: boolean;
}

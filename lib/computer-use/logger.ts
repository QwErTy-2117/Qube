import { logEvent } from "@/lib/agent/observability";
import type { KernelSummary } from "./types";

export function sanitizeArgs(tool: string, args: Record<string, unknown>, risk: string): Record<string, unknown> {
  const redact = risk === "credential" || /password|passcode|otp|secret|token|key/i.test(tool);
  const walk = (v: any): any => {
    if (typeof v === "string") {
      if (redact) return `[redacted ${v.length} chars]`;
      return v.length > 300 ? v.slice(0, 300) + "…[truncated]" : v;
    }
    if (Array.isArray(v)) return v.slice(0, 25).map(walk);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (/password|passcode|otp|secret|token|card/i.test(k) && typeof val === "string") o[k] = `[redacted ${(val as string).length} chars]`;
        else o[k] = walk(val);
      }
      return o;
    }
    return v;
  };
  try { return walk(args ?? {}) as Record<string, unknown>; } catch { return {}; }
}

export async function logAction(entry: {
  threadId: string; tool: string; domain: string; kind: string;
  summary: string; risk: string; decision: string; verdict: string;
  signals: string[]; latencyMs: number; args: Record<string, unknown>; url?: string;
}): Promise<void> {
  try {
    await logEvent({
      threadId: entry.threadId,
      type: "computer_action",
      status: entry.verdict === "failed" || entry.verdict === "denied" || entry.verdict === "blocked" ? "error" : "success",
      latencyMs: entry.latencyMs,
      metadata: {
        tool: entry.tool, domain: entry.domain, kind: entry.kind,
        summary: entry.summary.slice(0, 160), risk: entry.risk, decision: entry.decision,
        verdict: entry.verdict, signals: entry.signals.slice(0, 8),
        url: (entry.url || "").slice(0, 300), args: sanitizeArgs(entry.tool, entry.args, entry.risk),
      },
    });
  } catch {}
}

export function kernelTrailer(k: KernelSummary): string {
  const parts = [`verdict:${k.verdict}`, `risk:${k.risk}`];
  if (k.changed !== undefined) parts.push(k.changed ? "changed" : "unchanged");
  if (k.signals?.length) parts.push(`signals:${k.signals.join(",")}`);
  if (k.hints?.length) parts.push(`hint:${k.hints[0].slice(0, 200)}`);
  if (k.recovered?.length) parts.push(`recovered:${k.recovered.join(",")}`);
  if (k.repeat) parts.push("repeat:next-identical-blocked");
  if (k.blocked) parts.push("blocked:repeat_failure");
  return `[kernel ${parts.join(" | ")}]`;
}

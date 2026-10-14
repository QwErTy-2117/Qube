import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getDataDir } from "@/lib/data-dir";
import type { PageFingerprint } from "./types";

export interface ActionRecord {
  id: string;
  tool: string;
  summary: string;
  risk: string;
  verdict: string;
  signals: string[];
  at: number;
}

export interface Checkpoint {
  label: string;
  at: number;
  url: string;
  verdict: string;
}

export class StateTracker {
  private static instances = new Map<string, StateTracker>();
  history: ActionRecord[] = [];
  refs = new Map<string, { label: string; url: string }>();
  lastFingerprint: PageFingerprint | null = null;
  checkpoints: Checkpoint[] = [];
  private failures = new Map<string, number>();
  consecutiveFailures = 0;
  private idSeq = 0;

  static forThread(threadId: string): StateTracker {
    let s = StateTracker.instances.get(threadId);
    if (!s) { s = new StateTracker(); s.restore(threadId); StateTracker.instances.set(threadId, s); }
    return s;
  }
  static resetForTests(): void { StateTracker.instances.clear(); }

  nextId(): string { this.idSeq += 1; return `k${Date.now().toString(36)}_${this.idSeq}`; }

  noteRefs(url: string, elements: Array<{ ref: string; role?: string; name?: string }>): void {
    try {
      for (const el of elements || []) {
        if (!el || typeof el.ref !== "string" || !/^e\d+$/.test(el.ref)) continue;
        const label = `${el.role || "element"} "${String(el.name || "").slice(0, 120)}"`;
        this.refs.set(el.ref, { label, url });
      }
    } catch {}
  }

  indexSnapshotText(url: string, text: string): void {
    try {
      const re = /-\s+([^\n"\[]+?)\s+"([^"\n]{1,150})"\s+\[(e\d+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(String(text || "")))) {
        this.refs.set(m[3], { label: `${m[1].trim()} "${m[2].trim()}"`, url });
      }
    } catch {}
  }

  failuresFor(sig: string): number { return this.failures.get(sig) || 0; }
  noteFailure(sig: string): void {
    this.failures.set(sig, this.failuresFor(sig) + 1);
    this.consecutiveFailures += 1;
  }
  noteSuccess(): void { this.consecutiveFailures = 0; }
  clearFailures(sig: string): void { this.failures.delete(sig); }

  record(r: ActionRecord): void {
    this.history.push(r);
    if (this.history.length > 50) this.history.splice(0, this.history.length - 50);
  }

  /** Milestone marker for an important step that verifiably succeeded
   * (e.g. a navigation landing). Surfaced in resume context so the next
   * run knows what already worked instead of redoing it. */
  checkpoint(label: string, url = "", verdict = "verified"): void {
    try {
      this.checkpoints.push({ label: String(label).slice(0, 160), at: Date.now(), url: String(url).slice(0, 300), verdict });
      if (this.checkpoints.length > 20) this.checkpoints.splice(0, this.checkpoints.length - 20);
    } catch {}
  }

  private file(threadId: string): string {
    const safe = String(threadId || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "global";
    return join(getDataDir(), ".memory", "computer-use", `${safe}.json`);
  }

  restore(threadId: string): void {
    try {
      const raw = readFileSync(this.file(threadId), "utf-8");
      const p = JSON.parse(raw) as { history?: ActionRecord[]; lastUrl?: string; at?: number; checkpoints?: Checkpoint[] };
      if (Array.isArray(p.history)) this.history = p.history.slice(-50);
      if (Array.isArray(p.checkpoints)) this.checkpoints = p.checkpoints.slice(-20);
      if (p.lastUrl) this.lastFingerprint = { at: p.at || 0, url: p.lastUrl, title: "", textHash: "", textLen: 0, dialog: false };
    } catch {}
  }

  persist(threadId: string): void {
    try {
      const f = this.file(threadId);
      mkdirSync(join(getDataDir(), ".memory", "computer-use"), { recursive: true });
      const last = this.history[this.history.length - 1];
      const payload = {
        at: Date.now(),
        lastUrl: this.lastFingerprint?.url || "",
        history: this.history.slice(-50).map((h) => ({ ...h, summary: h.summary.slice(0, 160) })),
        checkpoints: this.checkpoints.slice(-20),
        lastVerdict: last?.verdict,
      };
      writeFileSync(f, JSON.stringify(payload).slice(0, 20000));
    } catch {}
  }

  resumeContext(): string {
    if (this.history.length === 0 && this.checkpoints.length === 0) return "";
    const last = this.history[this.history.length - 1];
    const fails = this.history.filter((h) => h.verdict === "failed" || h.verdict === "no_effect").slice(-3)
      .map((h) => h.summary).join("; ");
    let s = this.history.length > 0
      ? `Prior browser/computer session: last page ${this.lastFingerprint?.url || "unknown"} (${last.verdict}: ${last.summary}).`
      : `Prior browser/computer session.`;
    if (this.checkpoints.length > 0) {
      s += ` Confirmed checkpoints: ${this.checkpoints.slice(-5).map((c) => c.label).join("; ")}.`;
    }
    if (fails) s += ` Recent failures (do not blindly repeat): ${fails}.`;
    return s.slice(0, 600);
  }
}

import { describeAction } from "./catalog";
import { classifyRisk, decidePermission } from "./permission";
import { parseResult, verifyResult, type RawResult } from "./verify";
import { planRecovery } from "./recovery";
import { StateTracker } from "./state";
import { logAction, kernelTrailer } from "./logger";
import { observePage, resolveRefLabel, withConsoleNetworkSignals, type PageObservation } from "./observer";
import type { ActionDescriptor, KernelSummary, PageFingerprint, RecoveryPlan, RiskLevel, Verdict } from "./types";

export interface KernelDeps {
  threadId: string;
  interactive: boolean;
  askApproval?: (purpose: string, tool: string, args: Record<string, unknown>) => Promise<boolean>;
  resolveLabel?: (ref: string) => Promise<string | null>;
  probePage?: () => Promise<PageFingerprint | null>;
}

async function defaultProbe(): Promise<PageFingerprint | null> {
  try {
    const mod = await import("@/lib/pi/computer-use");
    const cdp = {
      getPageTarget: (mod as any).getPageTarget as () => Promise<{ webSocketDebuggerUrl?: string } | null>,
      cdpCall: (mod as any).cdpCall,
      evalIsolated: (mod as any).evalIsolated,
    };
    if (typeof cdp.getPageTarget !== "function" || typeof cdp.cdpCall !== "function" || typeof cdp.evalIsolated !== "function") return null;
    const obs: PageObservation | null = await observePage(cdp);
    if (!obs) return null;
    (defaultProbe as any)._lastObs = obs;
    return obs;
  } catch { return null; }
}

async function defaultResolveLabel(ref: string): Promise<string | null> {
  try {
    const mod = await import("@/lib/pi/computer-use");
    const cdp = {
      getPageTarget: (mod as any).getPageTarget as () => Promise<{ webSocketDebuggerUrl?: string } | null>,
      cdpCall: (mod as any).cdpCall,
      evalIsolated: (mod as any).evalIsolated,
    };
    if (typeof cdp.getPageTarget !== "function" || typeof cdp.evalIsolated !== "function") return null;
    return await resolveRefLabel(cdp, ref);
  } catch { return null; }
}

export function kernelEnabled(): boolean {
  return process.env.COMPUTER_USE_KERNEL !== "0";
}

function sigFor(desc: ActionDescriptor, preUrl: string): string {
  const norm = { refs: [...desc.refs].sort(), points: desc.points, typed: desc.typed.map((t) => t.length), keys: [...desc.keys].sort(), urls: desc.urls };
  return `${desc.tool}|${JSON.stringify(norm)}|${preUrl}`;
}

function blockedResult(tool: string, msg: string): string {
  return JSON.stringify({ blocked: "repeat_failure", tool, message: msg }).slice(0, 2000);
}
function deniedResult(tool: string, msg: string): string {
  return JSON.stringify({ error: "Operation not permitted", tool, message: msg }).slice(0, 2000);
}

function attachKernel(out: unknown, k: KernelSummary): unknown {
  if (typeof out === "string") {
    try {
      const p = JSON.parse(out);
      if (p && typeof p === "object" && !Array.isArray(p)) return JSON.stringify({ ...(p as object), _kernel: k }).slice(0, 14000);
    } catch {}
    return `${out}\n${kernelTrailer(k)}`.slice(0, 14000);
  }
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const o = out as any;
    if (Array.isArray(o.content)) return { ...o, content: [...o.content, { type: "text", text: kernelTrailer(k) }] };
    return { ...o, _kernel: k };
  }
  return out;
}

export function applyKernel(tools: Record<string, any>, deps: KernelDeps): Record<string, any> {
  const state = StateTracker.forThread(deps.threadId);
  const probePage = deps.probePage ?? defaultProbe;
  const resolveLabel = deps.resolveLabel ?? defaultResolveLabel;
  for (const [name, def] of Object.entries(tools)) {
    const orig = (def as any)?.execute;
    if (typeof orig !== "function" || (def as any).__kernel) continue;
    const desc0 = describeAction(name, {});
    if (desc0.domain === "other" || desc0.kind === "meta") continue;
    if (name === "request_takeover") continue;
    const bound = orig.bind(def);
    const wrapped = async (args: any, extra?: any) => {
      const input = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
      const desc = describeAction(name, input);
      const t0 = Date.now();
      let verdict: Verdict = "unknown";
      let risk: RiskLevel = "read";
      let decision = "allow";
      let signals: string[] = [];
      let changed = false;
      let hints: string[] = [];
      let recovered: string[] = [];
      let blocked = false;
      let repeat = false;
      let pre: PageFingerprint | null = null;
      const log = (v: Verdict) => {
        void logAction({
          threadId: deps.threadId, tool: name, domain: desc.domain, kind: desc.kind,
          summary: desc.summary, risk, decision, verdict: v, signals,
          latencyMs: Date.now() - t0, args: input, url: pre?.url || state.lastFingerprint?.url,
        });
      };
      // Terminal/file tools: no gating beyond existing withPerm — log + verify only.
      if (desc.domain === "terminal" || desc.domain === "file") {
        let out: unknown;
        try { out = await bound(args, extra); }
        catch (e: any) {
          verdict = "failed"; signals = ["error_text"];
          state.noteFailure(`${name}|terminal`);
          state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk: "interact", verdict, signals, at: Date.now() });
          log(verdict); state.persist(deps.threadId);
          throw e;
        }
        const raw = parseResult(out);
        verdict = raw.ok ? "verified" : "failed";
        signals = raw.ok ? [] : ["error_text"];
        if (raw.ok) { state.noteSuccess(); state.clearFailures(`${name}|terminal`); }
        else { state.noteFailure(`${name}|terminal`); hints.push(`Command failed: ${raw.errorText.slice(0, 200)} — read the output, fix the cause, then retry.`); }
        state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk: "interact", verdict, signals, at: Date.now() });
        log(verdict); state.persist(deps.threadId);
        if (!raw.ok) {
          const k: KernelSummary = { id: state.nextId(), risk: "interact", verdict, signals, hints };
          return attachKernel(out, k);
        }
        return out;
      }
      // Pre-probe context (fail-open).
      if (desc.domain === "browser" && desc.kind !== "observe") {
        try { pre = await probePage(); } catch { pre = null; }
      }
      if (!pre) pre = state.lastFingerprint;
      // Repeat guard (browser/desktop mutating only).
      const sig = sigFor(desc, pre?.url || "");
      if (desc.mutating && (desc.domain === "browser" || desc.domain === "desktop") && state.failuresFor(sig) >= 2) {
        verdict = "blocked"; blocked = true;
        hints = ["This exact action already failed twice on this page — STOP repeating it. Re-snapshot, verify the control, and switch methods (ref ↔ coordinates ↔ keyboard)."];
        state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk, verdict, signals: ["repeat_failure"], at: Date.now() });
        log(verdict);
        return blockedResult(name, hints[0]);
      }
      // Permission for browser non-observe.
      if (desc.domain === "browser" && desc.kind !== "observe") {
        const labels: string[] = [];
        for (const ref of desc.refs) {
          let label: string | null = null;
          const cached = state.refs.get(ref);
          if (cached) label = cached.label;
          if (!label) { try { label = await resolveLabel(ref); } catch { label = null; } }
          if (label) labels.push(label);
        }
        const typedRisk = desc.typed.length > 0;
        let r: RiskLevel = "interact";
        let purpose = desc.summary;
        for (const label of labels) {
          const c = classifyRisk({ label, url: pre?.url, typed: typedRisk });
          if (riskRank(c.risk) > riskRank(r)) { r = c.risk; purpose = `Click/fill "${label}" on ${hostOf(pre?.url)} — ${c.risk}`; }
        }
        if (labels.length === 0) {
          const typedHay = desc.typed.join(" ").slice(0, 200);
          const c = classifyRisk({ label: typedHay || desc.targetText, url: pre?.url, typed: typedRisk, coordinateBlind: desc.points.length > 0 || desc.keys.length > 0 });
          r = c.risk;
          purpose = desc.points.length > 0
            ? `Coordinate action at ${desc.points.map((p) => `${p.x},${p.y}`).join("; ")} on ${hostOf(pre?.url)} — ${r}`
            : `${desc.summary} on ${hostOf(pre?.url)} — ${r}`;
        }
        risk = r;
        const dec = decidePermission(risk, deps.interactive);
        decision = dec;
        if (dec === "deny") {
          verdict = "denied";
          const msg = `Headless/background runs cannot perform ${risk} browser actions. Report the blocker instead.`;
          state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk, verdict, signals, at: Date.now() });
          log(verdict);
          return deniedResult(name, msg);
        }
        if (dec === "ask") {
          let approved = false;
          try {
            if (deps.askApproval) approved = await deps.askApproval(purpose, name, input);
            else {
              const { createPermissionRequest } = await import("@/lib/middleware/permission-middleware");
              const { promise } = createPermissionRequest(name, input, purpose, deps.threadId);
              const timeoutMs = parseInt(process.env.PERMISSION_TIMEOUT_MS || "300000", 10);
              const res = await Promise.race([promise, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
              approved = res?.approved === true;
            }
          } catch { approved = false; }
          if (!approved) {
            verdict = "denied";
            state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk, verdict, signals, at: Date.now() });
            log(verdict);
            return deniedResult(name, `User did not approve this ${risk} action: ${purpose}`);
          }
        }
      } else if (desc.domain === "desktop") {
        risk = "interact"; decision = "allow";
      }
      // Execute (original errors must propagate).
      let out: unknown;
      let threw: unknown = null;
      try { out = await bound(args, extra); }
      catch (e) { threw = e; }
      // Post: index snapshots, verify.
      try {
        indexResult(state, name, out);
        if (desc.domain === "browser" && desc.kind !== "observe") {
          try {
            const post = await probePage();
            if (post) state.lastFingerprint = post;
            const raw: RawResult = threw ? { ok: false, errorText: threw instanceof Error ? threw.message : String(threw) } : parseResult(out);
            const v = verifyResult(raw, pre, post, desc.kind);
            verdict = v.verdict; changed = v.changed; signals = v.signals;
            try {
              const lastObs = (defaultProbe as any)._lastObs as PageObservation | undefined;
              if (lastObs && post && lastObs.at >= post.at - 2000) signals = withConsoleNetworkSignals(signals, lastObs);
            } catch {}
          } catch { verdict = threw ? "failed" : "unknown"; }
        } else {
          const raw: RawResult = threw ? { ok: false, errorText: threw instanceof Error ? threw.message : String(threw) } : parseResult(out);
          if (desc.kind === "observe") { verdict = raw.ok ? "verified" : "failed"; signals = raw.ok ? [] : ["error_text"]; }
          else { verdict = raw.ok ? "unknown" : "failed"; signals = raw.ok ? [] : ["error_text"]; if (raw.errorText && /stale ref|unknown ref|vanished|re-render/i.test(raw.errorText)) signals = ["stale_ref"]; }
        }
      } catch { if (verdict === "unknown" && threw) verdict = "failed"; }
      if (verdict === "failed" || verdict === "no_effect") {
        state.noteFailure(sig);
        const plan: RecoveryPlan = planRecovery({ verdict: verdict as "failed" | "no_effect", changed, signals }, { failures: state.failuresFor(sig) });
        hints = plan.hints;
        // Graduated repeat signaling: the guard blocks the NEXT identical
        // attempt once a signature has failed twice, so say so explicitly on
        // the second failure instead of letting the block come as a surprise.
        // (Terminal/file tools return earlier and never block by signature,
        // so this only fires where the guard actually applies.)
        if (desc.mutating && (desc.domain === "browser" || desc.domain === "desktop") && state.failuresFor(sig) >= 2) {
          repeat = true;
          hints = [...hints, "Final warning: this exact action has now failed twice on this page — the next identical attempt will be blocked. Switch methods now (ref ↔ coordinates ↔ keyboard) or re-observe first."];
        }
        // Execute the safe, idempotent auto-steps (currently: resnapshot).
        // This refreshes the tracker's page state so retries, guards, and
        // resume context operate on reality instead of the pre-failure view.
        // Anything else stays a hint for the model — never auto-acted.
        if (plan.autoSteps.includes("resnapshot") && desc.domain === "browser" && probePage) {
          try {
            const fresh = await probePage();
            if (fresh) {
              state.lastFingerprint = fresh;
              recovered.push("resnapshot");
            }
          } catch {}
        }
        if (state.consecutiveFailures >= 3) {
          hints = [...hints, "STOP: 3+ consecutive failures — re-read the goal, re-observe the page with a fresh snapshot, update the plan, and try a different approach or ask the user."];
        }
      } else if (verdict === "verified") {
        state.noteSuccess(); state.clearFailures(sig);
        // Milestone checkpoint: any verified action that landed a new page
        // (navigate tool OR a link click / submit that changed the URL) is
        // proof an important step succeeded — resume context reuses it
        // instead of redoing it.
        if (desc.domain === "browser" && signals.includes("url_changed")) {
          const url = state.lastFingerprint?.url || desc.urls[0] || "";
          if (url) state.checkpoint(`Reached ${url}`, url, verdict);
        }
      }
      state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk, verdict, signals, at: Date.now() });
      log(verdict); state.persist(deps.threadId);
      if (threw) {
        const terr = threw instanceof Error ? threw : new Error(String(threw));
        if (hints.length) terr.message = `${terr.message}\n[kernel hint: ${hints[0].slice(0, 300)}]`;
        throw terr;
      }
      const k: KernelSummary = { id: state.nextId(), risk, verdict, changed, signals, hints, blocked, recovered, repeat: repeat || undefined };
      const meaningful = desc.kind !== "observe" || verdict !== "verified" || signals.length > 0 || hints.length > 0;
      if (!meaningful) return out;
      return attachKernel(out, k);
    };
    (wrapped as any).__kernel = true;
    (def as any).execute = wrapped;
  }
  return tools;
}

function riskRank(r: RiskLevel): number {
  return (["read", "interact", "external", "financial", "destructive", "account", "credential"] as RiskLevel[]).indexOf(r);
}

function hostOf(url?: string): string {
  try { return new URL(url || "").hostname || "page"; } catch { return "page"; }
}

function indexResult(state: StateTracker, tool: string, out: unknown): void {
  try {
    if (typeof out === "string") {
      try {
        const p = JSON.parse(out);
        if (p && typeof p === "object" && Array.isArray((p as any).elements)) {
          state.noteRefs(String((p as any).url || ""), (p as any).elements);
          if ((p as any).url && (p as any).tree) state.indexSnapshotText(String((p as any).url), String((p as any).tree));
          return;
        }
        if (p && typeof p === "object" && typeof (p as any).url === "string" && typeof (p as any).screen === "string") {
          state.indexSnapshotText((p as any).url, (p as any).screen);
        }
      } catch {
        if (tool.includes("snapshot") || tool.includes("act") || tool.includes("navigate")) state.indexSnapshotText("", out);
      }
    } else if (out && typeof out === "object") {
      const o = out as any;
      const text = Array.isArray(o.content) ? o.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n") : "";
      if (text) state.indexSnapshotText("", text);
    }
  } catch {}
}

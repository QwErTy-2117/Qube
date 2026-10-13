# Computer-Use Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the computer-use kernel pipeline (describe → repeat-guard → permission → execute → verify → recover → log) wrapping existing tools in `lib/pi/harness.ts`, with no tool-name/schema changes.

**Architecture:** New `lib/computer-use/` module: pure functions (catalog, verify, permission-classify, recovery-plan) plus small stateful pieces (StateTracker, ActionExecutor, ActionLogger). Wired into harness's existing execute-wrapper loop. Kill switch `COMPUTER_USE_KERNEL=0`. Tests: `node:test` via `tsx`.

**Tech Stack:** TypeScript, existing `classifyLocalTool`, `createPermissionRequest`, `logEvent`, `BROWSER_MCP_TOOL_PREFIX`.

---

### Task 1: types + catalog

**Files:**
- Create: `lib/computer-use/types.ts`
- Create: `lib/computer-use/catalog.ts`
- Test: `tests/computer-use-kernel-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeAction, isKernelTool } from "../lib/computer-use/catalog";

describe("kernel catalog", () => {
  it("classifies browser_screenshot as read-only browser observe", () => {
    const d = describeAction("browser_screenshot", {});
    assert.equal(d.domain, "browser");
    assert.equal(d.kind, "observe");
    assert.equal(d.mutating, false);
  });
  it("classifies browser_act click as mutating interact with target ref", () => {
    const d = describeAction("browser_act", { actions: [{ kind: "click", ref: "e3" }] });
    assert.equal(d.kind, "interact");
    assert.equal(d.mutating, true);
    assert.deepEqual(d.refs, ["e3"]);
  });
  it("classifies obu_ tools by suffix", () => {
    assert.equal(describeAction("obu_snapshot", {}).kind, "observe");
    assert.equal(describeAction("obu_click", { x: 1, y: 2 }).kind, "interact");
  });
  it("passes through unknown tools", () => {
    assert.equal(isKernelTool("TodoWrite"), false);
    assert.equal(describeAction("TodoWrite", {}).domain, "other");
  });
  it("treats run_command as terminal exec with command text", () => {
    const d = describeAction("run_command", { command: "npm test" });
    assert.equal(d.domain, "terminal");
    assert.equal(d.kind, "exec");
    assert.equal(d.targetText, "npm test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/computer-use-kernel-catalog.test.ts`
Expected: FAIL with "Cannot find module '../lib/computer-use/catalog'"

- [ ] **Step 3: Write types.ts**

```ts
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
```

- [ ] **Step 4: Write catalog.ts**

```ts
import type { ActionDescriptor } from "./types";
import { BROWSER_MCP_TOOL_PREFIX } from "@/lib/pi/browser-mcp";

const OBSERVE_SUFFIX = new Set(["snapshot", "screenshot", "tabs", "page_info", "ping", "wait_load", "move_mouse"]);
const NAVIGATE_SUFFIX = new Set(["navigate", "open_tab"]);

function stripPrefix(tool: string): string {
  return tool.startsWith(BROWSER_MCP_TOOL_PREFIX) ? tool.slice(BROWSER_MCP_TOOL_PREFIX.length) : tool;
}

function base(tool: string, domain: ActionDescriptor["domain"], kind: ActionDescriptor["kind"], mutating: boolean): ActionDescriptor {
  return { tool, domain, kind, mutating, refs: [], points: [], typed: [], keys: [], urls: [], targetText: "", summary: tool };
}

export function isKernelTool(tool: string): boolean {
  return describeAction(tool, {}).domain !== "other";
}

function summarize(tool: string, parts: string[]): string {
  const s = parts.filter(Boolean).join(" ").slice(0, 160);
  return s ? `${tool} ${s}` : tool;
}

export function describeAction(tool: string, args: Record<string, unknown>): ActionDescriptor {
  const a = (args ?? {}) as Record<string, any>;
  switch (tool) {
    case "browser_screenshot":
    case "computer_observe":
      return { ...base(tool, "browser", "observe", false), summary: `${tool} observe` };
    case "browser_snapshot":
      return { ...base(tool, "browser", "observe", false), summary: `${tool} observe` };
    case "browser_navigate": {
      const url = String(a.url ?? "");
      return { ...base(tool, "browser", "navigate", false), urls: url ? [url] : [], targetText: url, summary: summarize(tool, [url]) };
    }
    case "open_path": {
      const p = String(a.path ?? "");
      const isUrl = /^https?:\/\//i.test(p);
      return { ...base(tool, isUrl ? "browser" : "file", isUrl ? "navigate" : "interact", false), urls: isUrl ? [p] : [], targetText: p, summary: summarize(tool, [p]) };
    }
    case "browser_act": {
      const d = { ...base(tool, "browser", "interact", true) };
      const acts = Array.isArray(a.actions) ? a.actions : [];
      for (const act of acts) {
        if (act && typeof act === "object") {
          const ref = String((act as any).ref ?? "");
          if (/^e\d+$/.test(ref)) d.refs.push(ref);
          const text = String((act as any).text ?? "");
          if (text) d.typed.push(text.slice(0, 200));
          if (String((act as any).kind) === "click") d.kind = "interact";
        }
      }
      if (d.refs.length === 0 && d.typed.length === 0) d.kind = "interact";
      d.summary = summarize(tool, d.refs.concat(d.typed.map((t) => `"${t.slice(0, 40)}"`)));
      return d;
    }
    case "browser_pixel_act":
    case "computer_act": {
      const d = { ...base(tool, "browser", "interact", true) };
      const acts = Array.isArray(a.actions) ? a.actions : [];
      let sawText = false;
      for (const act of acts) {
        if (!act || typeof act !== "object") continue;
        const kind = String((act as any).kind ?? "").toLowerCase();
        const x = Number((act as any).x);
        const y = Number((act as any).y);
        if (Number.isFinite(x) && Number.isFinite(y) && (kind === "click" || kind === "down" || kind === "up" || kind === "move")) {
          d.points.push({ x: Math.round(x), y: Math.round(y) });
        }
        const text = String((act as any).text ?? "");
        if (text && (kind === "type" || kind === "")) { d.typed.push(text.slice(0, 200)); sawText = true; }
        const key = String((act as any).key ?? "");
        if (key) d.keys.push(key.slice(0, 40));
      }
      if (sawText && d.points.length === 0 && d.keys.length === 0) d.kind = "input";
      d.summary = summarize(tool, [`${acts.length} step(s)`]);
      return d;
    }
    case "request_takeover":
      return { ...base(tool, "browser", "meta", false), targetText: String(a.reason ?? "").slice(0, 160), summary: summarize(tool, ["takeover"]) };
    case "run_command":
      return { ...base(tool, "terminal", "exec", true), targetText: String(a.command ?? "").slice(0, 300), summary: summarize(tool, [String(a.command ?? "").slice(0, 80)]) };
    case "read_file":
    case "list_directory":
      return { ...base(tool, "file", "observe", false), targetText: String(a.path ?? ""), summary: summarize(tool, [String(a.path ?? "")]) };
    case "write_file":
    case "edit_file":
    case "delete_file":
      return { ...base(tool, "file", "interact", true), targetText: String(a.path ?? (a as any).filepath ?? ""), summary: summarize(tool, [String(a.path ?? (a as any).filepath ?? "")]) };
    default: break;
  }
  if (tool.startsWith(BROWSER_MCP_TOOL_PREFIX)) {
    const suffix = stripPrefix(tool);
    const d = base(tool, "browser", "interact", true);
    if (OBSERVE_SUFFIX.has(suffix)) { d.kind = "observe"; d.mutating = false; }
    else if (NAVIGATE_SUFFIX.has(suffix)) {
      d.kind = "navigate"; d.mutating = false;
      const url = String(a.url ?? "");
      if (url) { d.urls = [url]; d.targetText = url; }
    } else if (suffix === "click" || suffix === "move_mouse") {
      const x = Number(a.x); const y = Number(a.y);
      if (Number.isFinite(x) && Number.isFinite(y)) d.points.push({ x: Math.round(x), y: Math.round(y) });
    } else if (suffix === "type") {
      const text = String(a.text ?? "");
      if (text) d.typed.push(text.slice(0, 200));
      d.kind = "input";
    } else if (suffix === "press_key") {
      const key = String(a.key ?? "");
      if (key) d.keys.push(key.slice(0, 40));
    } else if (suffix === "act") {
      const acts = Array.isArray(a.actions) ? a.actions : [];
      for (const act of acts) {
        const ref = String((act as any)?.ref ?? "");
        if (/^e\d+$/.test(ref)) d.refs.push(ref);
        const text = String((act as any)?.text ?? "");
        if (text) d.typed.push(text.slice(0, 200));
      }
    }
    d.summary = summarize(tool, d.refs.concat(d.urls).concat(d.typed.map((t) => `"${t.slice(0, 40)}"`)));
    return d;
  }
  if (tool.startsWith("computer_")) {
    const d = base(tool, "desktop", "interact", true);
    d.summary = summarize(tool, [String(a.app ?? a.text ?? a.key ?? "").slice(0, 60)]);
    return d;
  }
  return base(tool, "other", "meta", false);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/computer-use-kernel-catalog.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/computer-use/types.ts lib/computer-use/catalog.ts tests/computer-use-kernel-catalog.test.ts
git commit -m "feat: computer-use kernel action catalog"
```

### Task 2: permission classifier (pure) + verdict/verify (pure) + recovery planner (pure)

**Files:**
- Create: `lib/computer-use/permission.ts`
- Create: `lib/computer-use/verify.ts`
- Create: `lib/computer-use/recovery.ts`
- Test: `tests/computer-use-kernel-policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "../lib/computer-use/permission";
import { verifyResult } from "../lib/computer-use/verify";
import { planRecovery } from "../lib/computer-use/recovery";

describe("kernel policy", () => {
  it("flags financial labels", () => {
    assert.equal(classifyRisk({ label: "Place order", url: "https://shop.example.com/cart" }).risk, "financial");
  });
  it("flags destructive labels", () => {
    assert.equal(classifyRisk({ label: "Delete account", url: "https://x.com/" }).risk, "destructive");
  });
  it("does not flag cart removal", () => {
    assert.equal(classifyRisk({ label: "Remove from cart", url: "https://x.com/" }).risk, "interact");
  });
  it("flags password typing as credential", () => {
    assert.equal(classifyRisk({ label: "Password", typed: true }).risk, "credential");
  });
  it("detects stale ref failure", () => {
    const v = verifyResult({ ok: false, errorText: "Stale ref e4: page re-rendered" }, null, null, "interact");
    assert.equal(v.verdict, "failed");
    assert.ok(v.signals.includes("stale_ref"));
  });
  it("detects no-effect click", () => {
    const fp = { at: 1, url: "https://x.com/", title: "t", textHash: "h", textLen: 5, dialog: false };
    const v = verifyResult({ ok: true, errorText: "" }, fp, fp, "interact");
    assert.equal(v.verdict, "no_effect");
  });
  it("maps captcha to takeover hint", () => {
    const p = planRecovery({ verdict: "failed", changed: false, signals: ["captcha"] });
    assert.ok(p.hints.join(" ").includes("request_takeover"));
    assert.equal(p.autoSteps.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/computer-use-kernel-policy.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write permission.ts**

```ts
import type { RiskLevel } from "./types";

export interface RiskInput {
  label?: string;
  url?: string;
  typed?: boolean;
  coordinateBlind?: boolean;
  oldUrl?: string;
  newUrl?: string;
}

const FINANCIAL_RE = /(place\s*order|buy\s*now|complete\s*purchase|confirm\s*(purchase|payment|order)|pay\s*(now|$)|checkout\s*(and|with|\$|€|£)|subscribe|donate|transfer\s*(money|funds)|\bcheckout\b.*(pay|card|order))/i;
const DESTRUCTIVE_RE = /(\bdelete\b|\berase\b|\bdestroy\b|\bdeactivate\b|\bterminate\b|\bwipe\b|close\s*(my|your|the)?\s*account|cancel\s*(subscription|membership|account|plan)|remove\s*(my|your|the)?\s*account)/i;
const ACCOUNT_RE = /(change|reset|update)\s*(your|my|the)?\s*(password|email|phone|2fa|two-?factor)|sign\s*out\s*(of\s*)?(all|everywhere|other)|revoke\s*(access|session|token|key)|enable\s*(2fa|two-?factor)|disable\s*(2fa|two-?factor)|add\s*(payment|card|bank)|remove\s*(payment|card|bank))/i;
const EXTERNAL_RE = /\b(send|submit|post|publish|share|invite|reply|comment|tweet|sign\s*up|register|book|reserve|apply\s*(now|to|for)|confirm|upload)\b/i;
const CREDENTIAL_RE = /(password|passcode|otp|one-?time|2fa|two-?factor|authenticator|recovery\s*code|ssn|social\s*security|cvv|cvc|card\s*number|secret\s*key|api\s*key|private\s*key|seed\s*phrase)/i;
const CARD_DIGITS_RE = /\b\d{13,19}\b/;
const FINANCIAL_URL_RE = /\/(checkout|payment|billing|order|subscribe|donate|pay)(\/|$|\?|#)/i;
const ACCOUNT_URL_RE = /\/(delete|remove|deactivate|unsubscribe|close)[-_ ]?(account)?(\/|$|\?|#)|[?&](delete|unsubscribe|deactivate)=/i;

function localHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local") || h.endsWith(".test") || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

export function classifyRisk(input: RiskInput): { risk: RiskLevel; purpose: string } {
  const label = String(input.label ?? "").slice(0, 200);
  const lower = label.toLowerCase();
  let risk: RiskLevel = "interact";
  if (CREDENTIAL_RE.test(label) && input.typed) risk = "credential";
  else if (FINANCIAL_RE.test(label)) risk = "financial";
  else if (DESTRUCTIVE_RE.test(label)) risk = "destructive";
  else if (ACCOUNT_RE.test(label)) risk = "account";
  else if (EXTERNAL_RE.test(label)) risk = "external";
  const url = input.newUrl || input.url || input.oldUrl || "";
  if (risk === "interact" && input.coordinateBlind && FINANCIAL_URL_RE.test(url)) risk = "financial";
  if (risk === "interact" && ACCOUNT_URL_RE.test(url)) risk = "account";
  const typedText = input.typed ? " (typed input)" : "";
  const purpose = `${label || "browser action"}${typedText}`.slice(0, 220);
  return { risk, purpose };
}

export function decidePermission(risk: RiskLevel, interactive: boolean): "allow" | "ask" | "deny" {
  if (risk === "read" || risk === "interact") return "allow";
  return interactive ? "ask" : "deny";
}
```

- [ ] **Step 4: Write verify.ts**

```ts
import type { PageFingerprint, Verification } from "./types";

export interface RawResult { ok: boolean; errorText: string; uncertain?: boolean }

export function parseResult(out: unknown): RawResult {
  try {
    if (out == null) return { ok: true, errorText: "" };
    if (typeof out === "string") {
      const t = out.trim();
      if (/^error:/i.test(t)) return { ok: false, errorText: t.slice(0, 300) };
      if (/operation not permitted/i.test(t)) return { ok: false, errorText: t.slice(0, 300) };
      try {
        const p = JSON.parse(t);
        if (p && typeof p === "object") {
          const err = (p as any).error;
          if (err) return { ok: false, errorText: String(err).slice(0, 300) };
          if ((p as any).ok === false) return { ok: false, errorText: String((p as any).error || (p as any).message || "action failed").slice(0, 300) };
          if ((p as any).exitCode !== undefined && Number((p as any).exitCode) !== 0) return { ok: false, errorText: String((p as any).stderr || `exit ${(p as any).exitCode}`).slice(0, 300) };
          return { ok: true, errorText: "", uncertain: !!(p as any).uncertain };
        }
      } catch {}
      const m = t.match(/"error"\s*:\s*true/);
      if (m) return { ok: false, errorText: t.slice(0, 300) };
      return { ok: true, errorText: "" };
    }
    if (typeof out === "object") {
      const o = out as any;
      if (o.isError === true) {
        const text = Array.isArray(o.content) ? o.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim() : "";
        return { ok: false, errorText: (text || "tool error").slice(0, 300) };
      }
      if (typeof o.error === "string" && o.error) return { ok: false, errorText: o.error.slice(0, 300) };
      if (o.ok === false) return { ok: false, errorText: String(o.error || o.message || "action failed").slice(0, 300) };
      return { ok: true, errorText: "", uncertain: !!o.uncertain };
    }
    return { ok: true, errorText: "" };
  } catch { return { ok: true, errorText: "" }; }
}

const STALE_RE = /stale ref|unknown ref|element is gone|vanished mid-action|re-render/i;
const DISABLED_RE = /disabled|not clickable|not interactable|obscured|intercepted/i;
const NAVFAIL_RE = /timeout|net::|ERR_|DNS|connection refused|not attached|no live browser|navigation failed|404\b/i;
const CRASH_RE = /target closed|session closed|browser.*(crash|disconnect|unreachable)|ECONNREFUSED|socket hang up|websocket.*clos/i;
const AUTHWALL_RE = /sign in|log ?in|password|2fa|two-?factor|verify.*identity/i;
const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|verify you are human|i am not a robot|challenge/i;

export function verifyResult(raw: RawResult, pre: PageFingerprint | null, post: PageFingerprint | null, kind: string): Verification {
  const signals: string[] = [];
  if (!raw.ok) {
    if (STALE_RE.test(raw.errorText)) signals.push("stale_ref");
    else if (CRASH_RE.test(raw.errorText)) signals.push("crash");
    else if (DISABLED_RE.test(raw.errorText)) signals.push("disabled");
    else if (NAVFAIL_RE.test(raw.errorText)) signals.push("nav_failed");
    else signals.push("error_text");
    return { verdict: "failed", changed: false, signals };
  }
  if (kind === "observe" || kind === "meta") return { verdict: "verified", changed: false, signals };
  if (!post) return { verdict: "unknown", changed: false, signals };
  if (CAPTCHA_RE.test(`${post.title} ${post.url}`)) signals.push("captcha");
  else if (AUTHWALL_RE.test(`${post.title}`)) signals.push("auth_wall");
  if (post.dialog && !(pre && pre.dialog)) signals.push("new_dialog");
  if (!pre) return { verdict: "unknown", changed: false, signals };
  const urlChanged = pre.url !== post.url;
  const textChanged = pre.textHash !== post.textHash;
  if (urlChanged) signals.push("url_changed");
  if (textChanged) signals.push("text_changed");
  const changed = urlChanged || textChanged || signals.includes("new_dialog");
  if (signals.includes("captcha") || signals.includes("auth_wall")) return { verdict: "failed", changed, signals };
  if (changed) return { verdict: "verified", changed: true, signals };
  return { verdict: "no_effect", changed: false, signals };
}
```

- [ ] **Step 5: Write recovery.ts**

```ts
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
    hints.push("Browser connection lost — it will be restarted once with tabs restored. Re-navigate to the page and re-snapshot; do NOT replay the failed action blindly.");
    return { autoSteps: [], hints };
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/computer-use-kernel-policy.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/computer-use/permission.ts lib/computer-use/verify.ts lib/computer-use/recovery.ts tests/computer-use-kernel-policy.test.ts
git commit -m "feat: computer-use kernel policy (risk, verify, recovery)"
```

### Task 3: state tracker + executor + index + action log

**Files:**
- Create: `lib/computer-use/state.ts`
- Create: `lib/computer-use/logger.ts`
- Create: `lib/computer-use/executor.ts`
- Create: `lib/computer-use/index.ts`
- Test: `tests/computer-use-kernel-executor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyKernel } from "../lib/computer-use/index";

function strTool(impl: (args: any) => Promise<string> | string) {
  return { description: "t", inputSchema: {} as any, execute: async (args: any) => impl(args) };
}

describe("kernel executor", () => {
  it("passes through non-kernel tools untouched", () => {
    const tools = { TodoWrite: strTool(async () => "ok") };
    const out = applyKernel(tools, { threadId: "t1", interactive: true });
    assert.equal(out.TodoWrite, tools.TodoWrite);
  });
  it("verifies a click that changes the page", async () => {
    let n = 0;
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true, completed: 1 })) };
    const out = applyKernel(tools, { threadId: "t2", interactive: true });
    const raw = await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] });
    const p = JSON.parse(String(raw));
    assert.equal(p._kernel.verdict, "verified");
  });
  it("asks approval for financial actions and denies on refusal", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true })) };
    const out = applyKernel(tools, {
      threadId: "t3", interactive: true,
      askApproval: async () => false,
      resolveLabel: async (ref) => (ref === "e9" ? "Place order" : null),
    });
    const raw = await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e9" }] });
    assert.match(String(raw), /not permitted/i);
  });
  it("denies risky actions when headless", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ ok: true })) };
    const out = applyKernel(tools, {
      threadId: "t4", interactive: false,
      resolveLabel: async () => "Delete account",
    });
    const raw = await (out.browser_act as any).execute({ actions: [{ kind: "click", ref: "e1" }] });
    assert.match(String(raw), /headless|not permitted/i);
  });
  it("blocks a repeated failed action", async () => {
    const tools = { browser_act: strTool(async () => JSON.stringify({ error: "Stale ref e1: page re-rendered" })) };
    const out = applyKernel(tools, { threadId: "t5", interactive: true });
    const args = { actions: [{ kind: "click", ref: "e1" }] };
    await (out.browser_act as any).execute(args);
    await (out.browser_act as any).execute(args);
    const third = String(await (out.browser_act as any).execute(args));
    assert.match(third, /repeat_failure/);
  });
  it("fails open when the probe throws", async () => {
    const tools = { browser_snapshot: strTool(async () => JSON.stringify({ url: "https://x.com/", tree: "" })) };
    const out = applyKernel(tools, { threadId: "t6", interactive: true, probePage: async () => { throw new Error("cdp dead"); } });
    const raw = String(await (out.browser_snapshot as any).execute({}));
    assert.ok(raw.includes("https://x.com/"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/computer-use-kernel-executor.test.ts`
Expected: FAIL with "Cannot find module '../lib/computer-use/index'"

- [ ] **Step 3: Write state.ts**

```ts
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

export class StateTracker {
  private static instances = new Map<string, StateTracker>();
  history: ActionRecord[] = [];
  refs = new Map<string, { label: string; url: string }>();
  lastFingerprint: PageFingerprint | null = null;
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

  private file(threadId: string): string {
    const safe = String(threadId || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "global";
    return join(getDataDir(), ".memory", "computer-use", `${safe}.json`);
  }

  restore(threadId: string): void {
    try {
      const raw = readFileSync(this.file(threadId), "utf-8");
      const p = JSON.parse(raw) as { history?: ActionRecord[]; lastUrl?: string; at?: number };
      if (Array.isArray(p.history)) this.history = p.history.slice(-50);
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
        lastVerdict: last?.verdict,
      };
      writeFileSync(f, JSON.stringify(payload).slice(0, 20000));
    } catch {}
  }

  resumeContext(): string {
    if (this.history.length === 0) return "";
    const last = this.history[this.history.length - 1];
    const fails = this.history.filter((h) => h.verdict === "failed" || h.verdict === "no_effect").slice(-3)
      .map((h) => h.summary).join("; ");
    let s = `Prior browser/computer session: last page ${this.lastFingerprint?.url || "unknown"} (${last.verdict}: ${last.summary}).`;
    if (fails) s += ` Recent failures (do not blindly repeat): ${fails}.`;
    return s.slice(0, 500);
  }
}
```

- [ ] **Step 4: Write logger.ts**

```ts
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
  if (k.blocked) parts.push("blocked:repeat_failure");
  return `[kernel ${parts.join(" | ")}]`;
}
```

- [ ] **Step 5: Write executor.ts**

```ts
import { describeAction } from "./catalog";
import { classifyRisk, decidePermission } from "./permission";
import { parseResult, verifyResult, type RawResult } from "./verify";
import { planRecovery } from "./recovery";
import { StateTracker } from "./state";
import { logAction, kernelTrailer } from "./logger";
import type { ActionDescriptor, KernelSummary, PageFingerprint, RecoveryPlan, RiskLevel, Verdict } from "./types";

export interface KernelDeps {
  threadId: string;
  interactive: boolean;
  askApproval?: (purpose: string, tool: string, args: Record<string, unknown>) => Promise<boolean>;
  resolveLabel?: (ref: string) => Promise<string | null>;
  probePage?: () => Promise<PageFingerprint | null>;
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
      let blocked = false;
      let pre: PageFingerprint | null = null;
      const log = (v: Verdict) => {
        void logAction({
          threadId: deps.threadId, tool: name, domain: desc.domain, kind: desc.kind,
          summary: desc.summary, risk, decision, verdict: v, signals,
          latencyMs: Date.now() - t0, args: input, url: pre?.url || state.lastFingerprint?.url,
        });
      };
      try {
        // Pre-probe (fail-open) for observe-adjacent context; skipped for pure observe speed.
        if (desc.domain === "browser" && desc.kind !== "observe" && deps.probePage) {
          try { pre = await deps.probePage(); } catch { pre = null; }
        }
        if (!pre) pre = state.lastFingerprint;
        // Terminal/file tools: no gating beyond existing withPerm — log + verify only.
        if (desc.domain === "terminal" || desc.domain === "file") {
          let out: unknown;
          try { out = await bound(args, extra); }
          catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
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
        // Repeat guard (browser/desktop mutating only).
        const sig = sigFor(desc, pre?.url || "");
        if (desc.mutating && (desc.domain === "browser" || desc.domain === "desktop") && state.failuresFor(sig) >= 2) {
          verdict = "blocked"; blocked = true;
          hints = ["This exact action already failed twice on this page — STOP repeating it. Re-snapshot, verify the control, and switch methods (ref ↔ coordinates ↔ keyboard)."];
          state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk, verdict, signals: ["repeat_failure"], at: Date.now() });
          log(verdict);
          return blockedResult(name, hints[0]);
        }
        // Permission: resolve labels for refs, then classify + decide.
        if (desc.domain === "browser" && desc.kind !== "observe") {
          const labels: string[] = [];
          for (const ref of desc.refs) {
            let label: string | null = null;
            const cached = (state as any).refs?.get?.(ref) as { label: string } | undefined;
            if (cached) label = cached.label;
            if (!label && deps.resolveLabel) { try { label = await deps.resolveLabel(ref); } catch { label = null; } }
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
          risk = "interact"; decision = "allow"; // desktop tools self-gate via withPermissionCheck
        }
        // Execute (outside fail-open try: original errors must propagate).
        let out: unknown;
        let threw: unknown = null;
        try { out = await bound(args, extra); }
        catch (e) { threw = e; }
        // Post: index snapshots, fingerprint, verify.
        try {
          indexResult(state, name, out);
          if (deps.probePage && desc.domain === "browser" && desc.kind !== "observe") {
            try {
              const post = await deps.probePage();
              if (post) state.lastFingerprint = post;
              const raw: RawResult = threw ? { ok: false, errorText: threw instanceof Error ? threw.message : String(threw) } : parseResult(out);
              const v = verifyResult(raw, pre, post, desc.kind);
              verdict = v.verdict; changed = v.changed; signals = v.signals;
            } catch { verdict = threw ? "failed" : "unknown"; }
          } else {
            const raw: RawResult = threw ? { ok: false, errorText: threw instanceof Error ? threw.message : String(threw) } : parseResult(out);
            if (desc.kind === "observe") { verdict = raw.ok ? "verified" : "failed"; signals = raw.ok ? [] : ["error_text"]; }
            else { verdict = raw.ok ? "unknown" : "failed"; signals = raw.ok ? [] : ["error_text"]; if (raw.errorText && /stale ref|unknown ref|vanished|re-render/i.test(raw.errorText)) signals = ["stale_ref"]; }
          }
        } catch { if (verdict === "unknown" && threw) verdict = "failed"; }
        // Failure accounting + recovery.
        if (verdict === "failed" || verdict === "no_effect") {
          state.noteFailure(sig);
          const plan: RecoveryPlan = planRecovery({ verdict: verdict as "failed" | "no_effect", changed, signals }, { failures: state.failuresFor(sig) });
          hints = plan.hints;
          if (state.consecutiveFailures >= 3) {
            hints = [...hints, "STOP: 3+ consecutive failures — re-read the goal, re-observe the page with a fresh snapshot, update the plan, and try a different approach or ask the user."];
          }
        } else if (verdict === "verified") {
          state.noteSuccess(); state.clearFailures(sig);
        }
        state.record({ id: state.nextId(), tool: name, summary: desc.summary, risk, verdict, signals, at: Date.now() });
        log(verdict); state.persist(deps.threadId);
        if (threw) {
          const terr = threw instanceof Error ? threw : new Error(String(threw));
          if (hints.length) terr.message = `${terr.message}\n[kernel hint: ${hints[0].slice(0, 300)}]`;
          throw terr;
        }
        const k: KernelSummary = { id: state.nextId(), risk, verdict, changed, signals, hints, blocked };
        const meaningful = desc.kind !== "observe" || verdict !== "verified" || signals.length > 0 || hints.length > 0;
        if (!meaningful) return out;
        return attachKernel(out, k);
      } catch (e) {
        // Fail-open: never break the tool loop. Permission denials/blocks already returned above.
        if (e && typeof e === "object" && "__kernelPassthrough" in (e as any)) throw (e as any).cause;
        throw e;
      }
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
          state.lastFingerprint = state.lastFingerprint && (p as any).url
            ? { ...state.lastFingerprint, url: String((p as any).url) }
            : state.lastFingerprint;
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
```

- [ ] **Step 6: Write index.ts**

```ts
export * from "./types";
export { describeAction, isKernelTool } from "./catalog";
export { classifyRisk, decidePermission } from "./permission";
export { parseResult, verifyResult } from "./verify";
export { planRecovery } from "./recovery";
export { StateTracker } from "./state";
export { logAction, sanitizeArgs } from "./logger";
export { applyKernel, kernelEnabled, type KernelDeps } from "./executor";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/computer-use-kernel-executor.test.ts`
Expected: PASS (6 tests). Note: `probePage` is never injected in these tests, so `pre` stays null and permission labels resolve via `resolveLabel`/cache — by design.

- [ ] **Step 8: Commit**

```bash
git add lib/computer-use/state.ts lib/computer-use/logger.ts lib/computer-use/executor.ts lib/computer-use/index.ts tests/computer-use-kernel-executor.test.ts
git commit -m "feat: computer-use kernel executor with repeat-guard and risk gating"
```

### Task 4: wire into harness (+ task-runner, subagents) + prompt + resume

**Files:**
- Modify: `lib/pi/harness.ts` (~line 655, before the silent-continuation wrapper)
- Modify: `lib/pi/task-runner.ts` (after baseTools assembly, `interactive: false`)
- Modify: `lib/pi/subagents.ts` (after childTools selection, `interactive: false`)
- Modify: `lib/pi/prompt-context.ts` (append kernel paragraph to browser instructions)
- Test: existing `tests/prompts.test.ts` must still pass; manual check `npm test` later

- [ ] **Step 1: Harness edit** — insert after the computer-use tools merge (line ~646), before the schema-validation loop:

```ts
  // Computer-use kernel: uniform describe → repeat-guard → permission →
  // execute → verify → recover → log pipeline for browser/computer tools.
  // Wraps BEFORE the observer below so lastToolError sees kernel results.
  try {
    const { applyKernel, kernelEnabled, StateTracker } = await import("@/lib/computer-use/index");
    if (kernelEnabled()) {
      applyKernel(tools as Record<string, any>, { threadId: config.threadId, interactive: true });
      try {
        const resume = StateTracker.forThread(config.threadId).resumeContext();
        if (resume) systemPrompt += `\n\n${resume}`;
      } catch {}
    }
  } catch (e: any) {
    console.warn("[pi-harness] Kernel wrap failed (non-fatal):", (e?.message || String(e)).slice(0, 200));
  }
```

- [ ] **Step 2: task-runner edit** — find where `baseTools` is finalized (before `streamText({ ... tools: baseTools ... })`) and insert:

```ts
  try {
    const { applyKernel, kernelEnabled } = await import("@/lib/computer-use/index");
    if (kernelEnabled()) applyKernel(baseTools as Record<string, any>, { threadId, interactive: false });
  } catch {}
```

- [ ] **Step 3: subagents edit** — after `childTools` is selected, before `streamText`, insert:

```ts
  try {
    const { applyKernel, kernelEnabled } = await import("@/lib/computer-use/index");
    if (kernelEnabled()) applyKernel(childTools as Record<string, any>, { threadId: `subagent_${runId}`, interactive: false });
  } catch {}
```

- [ ] **Step 4: prompt edit** — in `lib/pi/prompt-context.ts`, append to the return of `browserUseInstructions`:

```ts
+ `Tool results may carry a [kernel ...] trailer or _kernel block with the action verdict (verified/no_effect/failed), change signals, and recovery hints. Respect repeat_failure blocks: never replay the blocked action — re-observe and switch methods.`
```

- [ ] **Step 5: Run related tests**

Run: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/prompts.test.ts tests/computer-use.test.ts tests/computer-use-kernel-catalog.test.ts tests/computer-use-kernel-policy.test.ts tests/computer-use-kernel-executor.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add lib/pi/harness.ts lib/pi/task-runner.ts lib/pi/subagents.ts lib/pi/prompt-context.ts
git commit -m "feat: wire computer-use kernel into harness, tasks, subagents"
```

### Task 5: full verification + spec touch-up

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: clean (baseline was clean)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: green (58+3 files)

- [ ] **Step 3: Update spec** — append a "Deviations" section to `docs/superpowers/specs/2026-10-13-computer-use-kernel-design.md` noting: kernel wraps BEFORE the harness observer (not replacing it); probePage/VisualObserver deferred to sub-project 2 (executor takes them as injectable deps); dialog auto-dismiss deferred (hints only); desktop verification is result-based only.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-13-computer-use-kernel-design.md docs/superpowers/plans/2026-10-13-computer-use-kernel.md
git commit -m "docs: kernel plan and spec deviations"
```

## Self-Review

- Spec coverage: pipeline stages ✓ (probe deferred as injectable, documented), risk gating ✓, repeat guard ✓, resume ✓, logging via logEvent ✓ (wires up observability), kill switch ✓, rollout ✓, tests ✓.
- No placeholders: all code blocks complete.
- Type consistency: `RiskInput`/`RawResult`/`KernelDeps` defined once and reused; `Verification`/`RecoveryPlan`/`KernelSummary` shared via types.ts.

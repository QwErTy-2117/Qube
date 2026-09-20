/**
 * Computer-use + page-browser layer ported from Rakazo (elie222/rakazo).
 *
 * Rakazo patterns copied here (adapted to Qube's local managed-Chrome):
 * - browser_navigate / browser_snapshot / browser_act with element refs
 *   (e1, e2…) + `fallback: "computer_act"` when page tools cannot operate.
 * - computer_observe / computer_act: up to 24 ordered desktop actions,
 *   batch only predictable actions, stop before uncertain outcomes.
 * - Snapshots: bounded page text + max 80 interactive elements, isolated
 *   script world, password masking, stale-ref rejection (never retarget).
 * - Failed actions report confirmed progress + uncertainty: inspect current
 *   state before continuing, never replay completed/uncertain actions.
 * - Identical consecutive desktop frames omit image bytes (metadata only).
 * - request_takeover for protected input / human judgment (waiting_takeover).
 *
 * Backing: Qube's managed Chromium via CDP (lib/browser/managed-chrome +
 * lib/browser/screencast). No E2B/Docker provider — local computer only.
 */

export const MAX_BROWSER_ACTIONS = 24;
export const MAX_COMPUTER_ACTIONS = 24;
export const MAX_SNAPSHOT_ELEMENTS = 80;
export const SNAPSHOT_TEXT_CHARS = 4000;

export type BrowserActStep =
  | { kind: "click"; ref: string }
  | { kind: "fill"; ref: string; text: string }
  | { kind: "type"; ref: string; text: string };

export type ComputerAction =
  | { kind: "pointer"; x: number; y: number; type: "click" | "move" | "down" | "up"; button: "left" | "right" }
  | { kind: "clipboard"; text: string }
  | { kind: "key"; key: string; modifiers?: string[] }
  | { kind: "scroll"; direction: "up" | "down"; amount: number }
  | { kind: "wait"; ms: number };

export type SnapshotElement = {
  ref: string;
  role: string;
  name: string;
  value?: string;
};

/** Parse browser_act actions (Rakazo browser-tools.ts parity, kinds: click/fill/type). */
export function parseBrowserActions(value: unknown): BrowserActStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("browser_act requires at least one action");
  }
  if (value.length > MAX_BROWSER_ACTIONS) {
    throw new Error(`browser_act accepts at most ${MAX_BROWSER_ACTIONS} actions`);
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`browser_act action ${index} must be an object`);
    const a = raw as Record<string, unknown>;
    const kind = String(a.kind ?? "");
    if (kind !== "click" && kind !== "fill" && kind !== "type") {
      throw new Error(`browser_act action ${index} has unsupported kind`);
    }
    const ref = String(a.ref ?? "").trim();
    if (!ref) throw new Error(`browser_act action ${index} requires ref`);
    if (kind === "fill" || kind === "type") {
      if (typeof a.text !== "string") throw new Error(`browser_act ${kind} requires text`);
      return { kind, ref, text: String(a.text) } as BrowserActStep;
    }
    return { kind, ref } as BrowserActStep;
  });
}

/** Parse computer_act actions (Rakazo computer-tools.ts parity). */
export function parseComputerActions(value: unknown): ComputerAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("computer_act requires at least one action");
  }
  if (value.length > MAX_COMPUTER_ACTIONS) throw new Error(`computer_act accepts at most ${MAX_COMPUTER_ACTIONS} actions`);
  const actions = (value as unknown[]).flatMap((raw): ComputerAction[] => {
    if (!raw || typeof raw !== "object") throw new Error("computer action must be an object");
    const a = raw as Record<string, unknown>;
    const kind = String(a.kind ?? "");
    if (kind === "click" || kind === "move" || kind === "down" || kind === "up") {
      const x = finiteCoordinate(a.x, "x");
      const y = finiteCoordinate(a.y, "y");
      const pointer: ComputerAction = {
        kind: "pointer",
        x,
        y,
        type: kind,
        button: a.button === "right" ? "right" : "left",
      };
      return a.double === true && kind === "click" ? [pointer, pointer] : [pointer];
    }
    if (kind === "type") return [{ kind: "clipboard", text: String(a.text ?? "") }];
    if (kind === "key") {
      return [{ kind: "key", key: String(a.key ?? ""), modifiers: Array.isArray(a.modifiers) ? a.modifiers.map(String) : undefined }];
    }
    if (kind === "scroll") {
      return [{ kind: "scroll", direction: a.direction === "up" ? "up" : "down", amount: boundedNumber(a.amount, 1, 20, 3) }];
    }
    if (kind === "wait") return [{ kind: "wait", ms: boundedNumber(a.ms, 0, 5000, 350) }];
    throw new Error(`unsupported computer action ${kind || "(missing)"}`);
  });
  if (actions.length > MAX_COMPUTER_ACTIONS) {
    throw new Error("computer_act expands to more than 24 actions; split the batch");
  }
  return actions;
}

function finiteCoordinate(value: unknown, name: string): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 100000) {
    throw new Error(`computer action ${name} must be a non-negative coordinate`);
  }
  return n;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Format snapshot tree (Rakazo computer-browser.ts parity). */
export function formatSnapshotTree(elements: SnapshotElement[]): string {
  if (elements.length === 0) return "(no interactive elements)";
  return elements
    .map((el) => {
      const value = el.value !== undefined && el.value !== "" ? ` value=${JSON.stringify(el.value)}` : "";
      return `- ${el.role} "${el.name}" [${el.ref}]${value}`;
    })
    .join("\n");
}

/** Attach fallback note (Rakazo browser-tools.ts parity). */
export function withBrowserFallback<T extends { fallback?: "computer_act"; error?: string }>(result: T): T & { note?: string } {
  if ((result as any).fallback === "computer_act") {
    return {
      ...result,
      note: "Page browser could not complete this step. Inspect the current state before continuing with computer_act if available, otherwise request_takeover. Do not replay completed or uncertain actions.",
    };
  }
  return result;
}

// ---------- CDP helpers (managed Chrome) ----------

async function getPageTarget(): Promise<{ id: string; webSocketDebuggerUrl?: string; url?: string } | null> {
  try {
    const mod = await import("@/lib/browser/managed-chrome");
    const p = mod.getBrowserPort();
    const res = await fetch(`http://127.0.0.1:${p}/json/list`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const targets = (await res.json()) as Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>;
    const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    const http = pages.filter((t) => /^https?:\/\//i.test(t.url));
    const pool = http.length ? http : pages;
    return pool[pool.length - 1] || null;
  } catch {
    return null;
  }
}

let _cdpId = 1;
async function cdpCall(wsUrl: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const { default: WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 8000 });
    let done = false;
    const id = _cdpId++ % 100000;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { ws.close(); } catch {}
        reject(new Error(`CDP ${method} timeout`));
      }
    }, 10000);
    ws.on("open", () => ws.send(JSON.stringify({ id, method, params })));
    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          done = true;
          try { ws.close(); } catch {}
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    ws.on("error", (e: unknown) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  });
}

// Isolated-world snapshot script: bounded text + up to 80 interactive
// elements, password values masked, stable refs (e1…), no retargeting.
const SNAPSHOT_EXPR = `(() => {
  const text = (document.body ? document.body.innerText : "").slice(0, ${SNAPSHOT_TEXT_CHARS});
  const els = [];
  const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [onclick]';
  const nodes = Array.from(document.querySelectorAll(sel)).slice(0, ${MAX_SNAPSHOT_ELEMENTS});
  let n = 0;
  for (const el of nodes) {
    n++;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (rect && (rect.width === 0 && rect.height === 0)) continue;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    const role = el.getAttribute && el.getAttribute("role") || (tag === "a" ? "link" : tag === "input" && (type === "checkbox" ? "checkbox" : "textbox") || tag === "select" ? "combobox" : tag === "textarea" ? "textbox" : tag === "button" ? "button" : tag || "element");
    let name = (el.getAttribute && (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.name || el.id || tag) || tag || "element").toString().replace(/\\s+/g, " ").trim().slice(0, 120);
    let value = "";
    try {
      if (tag === "input" && (type === "password")) value = "***";
      else if (tag === "input" || tag === "textarea" || tag === "select") value = String(el.value || "").slice(0, 200);
    } catch {}
    els.push({ ref: "e" + n, role, name, value });
    try { el.setAttribute("data-qube-ref", "e" + n); } catch {}
  }
  return { title: document.title, url: location.href, text, elements: els };
})()`;

async function evalIsolated(wsUrl: string, expression: string): Promise<any> {
  // Try an isolated world first (Rakazo parity: isolated script world so page
  // JS can't interfere), fall back to the default world when CDP rejects the
  // call (e.g. frameId requirements on some Chromium builds).
  try {
    const ctx = await cdpCall(wsUrl, "Page.createIsolatedWorld", { worldName: "qube_browser", grantUniversalAccess: false });
    const contextId = (ctx as any)?.executionContextId;
    if (contextId) {
      const r = await cdpCall(wsUrl, "Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
      return r?.result?.value;
    }
  } catch {}
  const r = await cdpCall(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
}

/** browser_navigate via CDP Page.navigate. */
export async function browserNavigate(url: string): Promise<{ url: string; title: string } & { fallback?: "computer_act"; error?: string }> {
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) {
    return withBrowserFallback({ url, title: "", fallback: "computer_act" as const, error: "Page browser is not attached. Use computer_act on the desktop browser instead." });
  }
  try {
    await cdpCall(target.webSocketDebuggerUrl, "Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 900));
    const v = await evalIsolated(target.webSocketDebuggerUrl, "({title: document.title, url: location.href})").catch(() => null);
    return { url: v?.url || url, title: v?.title || "" };
  } catch (e) {
    return withBrowserFallback({ url, title: "", fallback: "computer_act" as const, error: e instanceof Error ? e.message : String(e) });
  }
}

/** browser_snapshot via isolated world. */
export async function browserSnapshot(): Promise<{ url: string; title: string; tree: string; elements: SnapshotElement[] } & { fallback?: "computer_act"; error?: string }> {
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) {
    return withBrowserFallback({ url: "", title: "", tree: "", elements: [], fallback: "computer_act" as const, error: "Page browser is not attached. Use computer_act instead." });
  }
  try {
    const v = await evalIsolated(target.webSocketDebuggerUrl, SNAPSHOT_EXPR);
    const elements = Array.isArray(v?.elements) ? v.elements.slice(0, MAX_SNAPSHOT_ELEMENTS) : [];
    return {
      url: String(v?.url || target.url || ""),
      title: String(v?.title || ""),
      tree: `${String(v?.text || "").slice(0, SNAPSHOT_TEXT_CHARS)}\n\n${formatSnapshotTree(elements)}`,
      elements,
    };
  } catch (e) {
    return withBrowserFallback({ url: "", title: "", tree: "", elements: [], fallback: "computer_act" as const, error: e instanceof Error ? e.message : String(e) });
  }
}

/** browser_act: click/fill/type by ref. Stale refs are rejected, never retargeted. */
export async function browserAct(actions: BrowserActStep[]): Promise<{ ok: boolean; completed: number; uncertain: boolean; url: string; title: string } & { fallback?: "computer_act"; error?: string; tree?: string }> {
  const parsed = parseBrowserActions(actions);
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) {
    return withBrowserFallback({ ok: false, completed: 0, uncertain: true, url: "", title: "", fallback: "computer_act" as const, error: "Page browser is not attached." });
  }
  const wsUrl = target.webSocketDebuggerUrl;
  let completed = 0;
  try {
    for (const a of parsed) {
      const expr = `(() => {
        const el = document.querySelector('[data-qube-ref="' + ${JSON.stringify(a.ref)} + '"]');
        if (!el) return { found: false };
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        if (${a.kind === "click" ? "true" : "false"}) { el.click(); return { found: true }; }
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
          el.focus();
          ${a.kind === "fill" ? "el.value = " + JSON.stringify((a as { text: string }).text) + "; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));" : ""}
          return { found: true };
        }
        return { found: true, notEditable: true };
      })()`;
      const res = await evalIsolated(wsUrl, expr);
      if (!res?.found) {
        return withBrowserFallback({
          ok: false, completed, uncertain: completed > 0,
          url: target.url || "", title: "",
          fallback: "computer_act" as const,
          error: `Stale ref ${a.ref}: element not found — the page changed since your snapshot. Take a fresh browser_snapshot and retry the intended action with the new ref in this same turn; do not stop or summarize. Only skip actions already confirmed completed.`,
        });
      }
      if ((a.kind === "type" || (res as any)?.notEditable) && "text" in a) {
        await cdpCall(wsUrl, "Input.insertText", { text: (a as { text: string }).text });
      }
      completed++;
      await new Promise((r) => setTimeout(r, 250));
    }
    const v = await evalIsolated(wsUrl, "({title: document.title, url: location.href})").catch(() => null);
    return { ok: true, completed, uncertain: false, url: v?.url || target.url || "", title: v?.title || "" };
  } catch (e) {
    return withBrowserFallback({
      ok: false, completed, uncertain: true,
      url: target.url || "", title: "",
      fallback: "computer_act" as const,
      error: `${e instanceof Error ? e.message : String(e)} — confirmed ${completed}/${parsed.length} actions. Inspect current state before continuing; never replay completed or uncertain actions.`,
    });
  }
}

// ---------- computer_observe / computer_act ----------

let lastFrameId: string | null = null;
let lastFrameBytes: string | null = null;

function frameIdFor(jpgBase64: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < jpgBase64.length; i += 7) {
    h ^= jpgBase64.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + "-" + jpgBase64.length;
}

/** computer_observe: screenshot via CDP Page.captureScreenshot (dedup identical frames). */
export async function computerObserve(note = "computer observed"): Promise<{ text: string; imageBase64?: string; mimeType?: string; frameId?: string; unchanged?: boolean; error?: string }> {
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) return { text: `${note}: no live browser target`, error: "no live browser target" };
  try {
    const shot = await cdpCall(target.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "jpeg", quality: 60 });
    const data = String((shot as any)?.data || "");
    if (!data) return { text: `${note}: empty screenshot`, error: "empty screenshot" };
    const frameId = frameIdFor(data);
    const unchanged = lastFrameId === frameId;
    lastFrameId = frameId;
    if (unchanged) {
      // Rakazo parity: identical frames keep metadata but omit image bytes.
      return { text: `${note} (screen unchanged)\n${JSON.stringify({ frameId })}`, frameId, unchanged: true };
    }
    lastFrameBytes = data;
    void lastFrameBytes;
    return { text: `${note}\n${JSON.stringify({ frameId })}`, imageBase64: data, mimeType: "image/jpeg", frameId, unchanged: false };
  } catch (e) {
    return { text: `${note} failed`, error: e instanceof Error ? e.message : String(e) };
  }
}

/** computer_act: ordered batched desktop actions via CDP Input.*. */
export async function computerAct(actions: ComputerAction[], opts?: { observe?: boolean; settleMs?: number }): Promise<{ text: string; imageBase64?: string; completed: number; uncertain: boolean; error?: string }> {
  const parsed = parseComputerActions(actions);
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) return { text: "computer_act: no live browser target", completed: 0, uncertain: true, error: "no live target" };
  const wsUrl = target.webSocketDebuggerUrl;
  let completed = 0;
  try {
    for (const a of parsed) {
      if (a.kind === "pointer") {
        const base = { x: a.x, y: a.y, button: a.button };
        if (a.type === "click") {
          await cdpCall(wsUrl, "Input.dispatchMouseEvent", { ...base, type: "mousePressed", clickCount: 1 });
          await cdpCall(wsUrl, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased", clickCount: 1 });
        } else if (a.type === "move") {
          await cdpCall(wsUrl, "Input.dispatchMouseEvent", { ...base, type: "mouseMoved" });
        } else if (a.type === "down") {
          await cdpCall(wsUrl, "Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
        } else {
          await cdpCall(wsUrl, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
        }
      } else if (a.kind === "clipboard") {
        // Rakazo parity: "type" maps to clipboard paste path.
        await cdpCall(wsUrl, "Input.insertText", { text: a.text });
      } else if (a.kind === "key") {
        const code = a.key.length === 1 ? `Key${a.key.toUpperCase()}` : a.key;
        await cdpCall(wsUrl, "Input.dispatchKeyEvent", { type: "keyDown", key: a.key, code, modifiers: (a.modifiers || []).includes("Shift") ? 8 : 0 });
        await cdpCall(wsUrl, "Input.dispatchKeyEvent", { type: "keyUp", key: a.key, code });
      } else if (a.kind === "scroll") {
        await cdpCall(wsUrl, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 450, deltaX: 0, deltaY: a.direction === "down" ? 120 * a.amount : -120 * a.amount });
      } else if (a.kind === "wait") {
        await new Promise((r) => setTimeout(r, a.ms));
      }
      completed++;
    }
    // Rakazo parity: batch predictable actions with observe:false; observe by default.
    if (opts?.observe === false) {
      return { text: `computer_act confirmed ${completed}/${parsed.length} actions (observe:false — no screenshot).`, completed, uncertain: false };
    }
    // Rakazo parity: settle_ms lets the desktop settle before the screenshot.
    const settleMs = Math.min(Math.max(Math.round(Number(opts?.settleMs) || 0), 0), 5000);
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    const obs = await computerObserve("computer_act result");
    return { text: obs.text, imageBase64: obs.imageBase64, completed, uncertain: false };
  } catch (e) {
    return {
      text: `computer_act confirmed ${completed}/${parsed.length} actions. Inspect current state before continuing; never replay completed or uncertain actions.`,
      completed, uncertain: true, error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------- Screen lease (single-screen claim, Rakazo computer-screens parity) ----------

const SCREEN_BUSY = "The computer screen is temporarily busy. Retry in a moment. File and shell tools still work.";

/** Takeover lease TTL (Rakazo computer-control.ts parity: 15 min default). */
export const DEFAULT_TAKEOVER_LEASE_MS = 15 * 60 * 1000;

export function takeoverLeaseMs(): number {
  const raw = Number(process.env.COMPUTER_TAKEOVER_TTL_MS ?? DEFAULT_TAKEOVER_LEASE_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_TAKEOVER_LEASE_MS;
}

class SingleScreenClaimTracker {
  private owner: { key: string; leaseId?: string } | null = null;
  claim(key: string, leaseId?: string): void {
    if (this.owner && this.owner.key !== key) throw new Error(SCREEN_BUSY);
    if (this.owner && leaseId && this.owner.leaseId && leaseId !== this.owner.leaseId) throw new Error(SCREEN_BUSY);
    this.owner = { key, leaseId: leaseId ?? this.owner?.leaseId };
  }
  release(key: string, leaseId?: string): boolean {
    if (!this.owner || this.owner.key !== key) return false;
    if (leaseId && this.owner.leaseId && leaseId !== this.owner.leaseId) return false;
    this.owner = null;
    return true;
  }
}

export const screenClaim = new SingleScreenClaimTracker();
export const COMPUTER_SCREEN_UNAVAILABLE = SCREEN_BUSY;

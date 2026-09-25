/**
 * Browser-only automation layer ported from Rakazo (elie222/rakazo).
 *
 * IMPORTANT SCOPE: this is NOT OS desktop control. Everything here drives
 * Qube's managed Chromium window via CDP (lib/browser/managed-chrome +
 * lib/browser/screencast). There is no desktop screenshot, no OS window
 * control, no Start-menu launcher, no calculator/text-editor automation.
 * Former `computer_*` names are kept as deprecated aliases only.
 *
 * Rakazo patterns copied here (adapted to Qube's local managed-Chrome):
 * - browser_navigate / browser_snapshot / browser_act with element refs
 *   (e1, e2…) + `fallback: "browser_pixel_act"` when page tools cannot operate.
 * - browser_screenshot / browser_pixel_act: up to 24 ordered browser-window
 *   actions, batch only predictable actions, stop before uncertain outcomes.
 * - Snapshots: bounded page text + first 80 VISIBLE interactive elements,
 *   isolated script world, password masking, stale-ref self-healing (settle
 *   → re-snapshot → descriptor re-match → in-page retry; pixel fallback only
 *   when healing truly fails).
 * - Failed actions report confirmed progress + uncertainty: inspect current
 *   state before continuing, never replay completed/uncertain actions.
 * - Identical consecutive browser frames omit image bytes (metadata only).
 * - request_takeover for protected input / human judgment (waiting_takeover).
 *
 * Backing: Qube's managed Chromium via CDP (lib/browser/managed-chrome +
 * lib/browser/screencast). No E2B/Docker provider — managed browser only.
 */

export const MAX_BROWSER_ACTIONS = 24;
export const MAX_COMPUTER_ACTIONS = 24;
export const MAX_PIXEL_ACTIONS = MAX_COMPUTER_ACTIONS;
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

/** Canonical name for x/y actions inside the managed browser window. */
export type BrowserPixelAction = ComputerAction;

export type SnapshotElement = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  /** Descriptors for stale-ref self-healing (added; tree text unchanged). */
  tag?: string;
  type?: string;
  href?: string;
  idx?: number;
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

export const COMPUTER_ACT_KINDS = ["click", "move", "down", "up", "type", "key", "scroll", "wait"] as const;

const KEY_ALIASES: Record<string, string> = {
  press: "key",
  hotkey: "key",
  shortcut: "key",
  keypress: "key",
};

const OS_LAUNCHER_KEYS = new Set(["super", "meta", "os", "windows", "win", "cmd", "command"]);

function normalizeModifiers(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const m of raw) {
    const s = String(m).toLowerCase();
    if (s === "ctrl" || s === "control") out.push("Ctrl");
    else if (s === "shift") out.push("Shift");
    else if (s === "alt" || s === "option") out.push("Alt");
    else if (s === "meta" || s === "super" || s === "cmd" || s === "command" || s === "windows" || s === "win") out.push("Meta");
    else out.push(String(m));
  }
  return out.length ? out : undefined;
}

/** Parse browser_pixel_act actions (Rakazo computer-tools.ts parity, browser-only). */
export function parsePixelActions(value: unknown): ComputerAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `browser_pixel_act requires at least one action. Valid kinds: ${COMPUTER_ACT_KINDS.join(", ")}. ` +
        `Example: [{kind:"click",x:640,y:450},{kind:"type",text:"hello"},{kind:"key",key:"Enter"}]`
    );
  }
  if (value.length > MAX_COMPUTER_ACTIONS) throw new Error(`browser_pixel_act accepts at most ${MAX_COMPUTER_ACTIONS} actions`);
  const actions = (value as unknown[]).flatMap((raw): ComputerAction[] => {
    if (!raw || typeof raw !== "object") throw new Error("browser pixel action must be an object");
    const a = raw as Record<string, unknown>;
    let kind = String(a.kind ?? "").toLowerCase();
    if (!kind && typeof a.action === "string") kind = String(a.action).toLowerCase();
    if (KEY_ALIASES[kind]) kind = KEY_ALIASES[kind];
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
    if (kind === "type") {
      const text = String(a.text ?? "");
      if (!text) throw new Error(`browser_pixel_act type requires non-empty text`);
      return [{ kind: "clipboard", text }];
    }
    if (kind === "key") {
      const key = String(a.key ?? a.keys ?? "").trim();
      if (!key) throw new Error(`browser_pixel_act key requires key (e.g. Enter, Tab, Escape, a). Valid kinds: ${COMPUTER_ACT_KINDS.join(", ")}`);
      // The managed browser has no OS launcher: pressing Super/Meta/Windows
      // alone cannot open a text editor or calculator. Guide to supported paths.
      if (OS_LAUNCHER_KEYS.has(key.toLowerCase())) {
        throw new Error(
          `browser_pixel_act cannot press ${key} — there is no OS desktop or Start menu, only the managed browser window. ` +
            `To open a file/URL use open_path; for shell work use run_command. ` +
            `Do not retry the same key press.`
        );
      }
      const modifiers = normalizeModifiers(a.modifiers);
      if (modifiers?.includes("Meta")) {
        throw new Error(
          `browser_pixel_act Meta/Super/Cmd modifier is not supported — the managed browser has no OS desktop. ` +
            `Use open_path for workspace files/URLs or run_command for shell work. Do not retry with Super.`
        );
      }
      return [{ kind: "key", key, modifiers }];
    }
    if (kind === "scroll") {
      return [{ kind: "scroll", direction: a.direction === "up" ? "up" : "down", amount: boundedNumber(a.amount, 1, 20, 3) }];
    }
    if (kind === "wait") return [{ kind: "wait", ms: boundedNumber(a.ms, 0, 5000, 350) }];
    throw new Error(
      `unsupported browser action ${String((a as Record<string, unknown>).kind ?? kind) || "(missing)"}. ` +
        `Valid kinds: ${COMPUTER_ACT_KINDS.join(", ")}. ` +
        `For key presses use {kind:"key",key:"Enter"} with optional modifiers ["Ctrl","Shift","Alt"]. ` +
        `There is no OS desktop — OS launcher keys (Super/Meta) are not supported, use open_path or run_command instead. Do not retry the same call.`
    );
  });
  if (actions.length > MAX_COMPUTER_ACTIONS) {
    throw new Error("browser_pixel_act expands to more than 24 actions; split the batch");
  }
  return actions;
}

/** @deprecated Use parsePixelActions — old computer_act name kept for back-compat. */
export const parseComputerActions = parsePixelActions;

function finiteCoordinate(value: unknown, name: string): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 100000) {
    throw new Error(`browser action ${name} must be a non-negative coordinate`);
  }
  return n;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** CDP modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function modifiersBitmask(modifiers?: string[]): number {
  let mask = 0;
  for (const m of modifiers || []) {
    const s = String(m).toLowerCase();
    if (s === "alt") mask |= 1;
    else if (s === "ctrl" || s === "control") mask |= 2;
    else if (s === "meta") mask |= 4;
    else if (s === "shift") mask |= 8;
  }
  return mask;
}

const KEY_CODE_MAP: Record<string, { code: string; windowsVirtualKeyCode: number; text?: string }> = {
  enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  esc: { code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { code: "Delete", windowsVirtualKeyCode: 46 },
  space: { code: "Space", windowsVirtualKeyCode: 32, text: " " },
  arrowleft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  arrowright: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
  arrowup: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  arrowdown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  home: { code: "Home", windowsVirtualKeyCode: 36 },
  end: { code: "End", windowsVirtualKeyCode: 35 },
  pageup: { code: "PageUp", windowsVirtualKeyCode: 33 },
  pagedown: { code: "PageDown", windowsVirtualKeyCode: 34 },
};

/** Map a logical key to CDP code + windowsVirtualKeyCode. */
export function describeKey(key: string): { code: string; windowsVirtualKeyCode: number; text?: string } {
  const lower = key.toLowerCase();
  if (KEY_CODE_MAP[lower]) {
    const e = KEY_CODE_MAP[lower];
    // Preserve canonical key name for CDP (Enter, Tab, ...).
    return e;
  }
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (/^[A-Z]$/.test(upper)) return { code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), text: key };
    if (/^[0-9]$/.test(key)) return { code: `Digit${key}`, windowsVirtualKeyCode: key.charCodeAt(0), text: key };
    return { code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), text: key };
  }
  // Function keys F1-F12.
  const fn = /^f(\d{1,2})$/i.exec(key);
  if (fn) {
    const n = Number(fn[1]);
    if (n >= 1 && n <= 12) return { code: key.toUpperCase(), windowsVirtualKeyCode: 111 + n };
  }
  return { code: key, windowsVirtualKeyCode: 0 };
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

export type PixelFallback = "browser_pixel_act" | "computer_act";

/** Attach fallback note (Rakazo browser-tools.ts parity, browser-only). */
export function withBrowserFallback<T extends { fallback?: PixelFallback; error?: string }>(result: T): T & { note?: string } {
  if ((result as any).fallback === "browser_pixel_act" || (result as any).fallback === "computer_act") {
    return {
      ...result,
      note: "Page tools could not complete this step. Inspect the current state before continuing with browser_pixel_act if available, otherwise request_takeover. Do not replay completed or uncertain actions.",
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

// Isolated-world snapshot script: bounded text + first 80 VISIBLE interactive
// elements (dense refs e1… that reach below-fold content on ad-heavy pages),
// password values masked, descriptors kept for stale-ref self-healing.
const SNAPSHOT_EXPR = `(() => {
  const text = (document.body ? document.body.innerText : "").slice(0, ${SNAPSHOT_TEXT_CHARS});
  const els = [];
  const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [onclick]';
  const nodes = Array.from(document.querySelectorAll(sel));
  let n = 0;
  for (let idx = 0; idx < nodes.length && els.length < ${MAX_SNAPSHOT_ELEMENTS}; idx++) {
    const el = nodes[idx];
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect || (rect.width === 0 && rect.height === 0)) continue;
    n++;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    const role = el.getAttribute && el.getAttribute("role") || (tag === "a" ? "link" : tag === "input" && (type === "checkbox" ? "checkbox" : "textbox") || tag === "select" ? "combobox" : tag === "textarea" ? "textbox" : tag === "button" ? "button" : tag || "element");
    let name = (el.getAttribute && (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.name || el.id || tag) || tag || "element").toString().replace(/\\s+/g, " ").trim().slice(0, 120);
    const href = (tag === "a" && el.getAttribute && el.getAttribute("href") || "").toString().slice(0, 200);
    let value = "";
    try {
      if (tag === "input" && (type === "password")) value = "***";
      else if (tag === "input" || tag === "textarea" || tag === "select") value = String(el.value || "").slice(0, 200);
    } catch {}
    els.push({ ref: "e" + n, idx, role, name, tag, type, href, value });
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

// ---------- Stale-ref self-healing (auto-mcp server.mjs parity) ----------
// Rapid re-renders (Amazon-style carousels, lazy-load, sponsored slots) wipe
// data-qube-ref attrs between snapshot and act. Instead of punting to the
// model on every race, browserAct heals in-page: settle → re-snapshot →
// fuzzy re-match (href-path + /dp/ASIN aware, so session-token rotation
// doesn't break product links) → re-tag → retry, up to 3 attempts per action.

type RefDescriptor = {
  role: string;
  name: string;
  tag?: string;
  type?: string;
  href?: string;
};

let lastBrowserSnap: { url: string; at: number; refs: Map<string, RefDescriptor> } = {
  url: "",
  at: 0,
  refs: new Map(),
};

function rememberSnapshotRefs(url: string, elements: SnapshotElement[]): void {
  lastBrowserSnap = {
    url,
    at: Date.now(),
    refs: new Map(
      elements.map((e) => [
        e.ref,
        { role: e.role, name: e.name, tag: e.tag, type: e.type, href: e.href },
      ])
    ),
  };
}

export function normRefText(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
}

export function refHrefPath(h: unknown): string {
  try {
    return new URL(String(h ?? ""), "http://local").pathname || "";
  } catch {
    return String(h ?? "").split("?")[0].split("#")[0];
  }
}

export function refDpAsin(h: unknown): string {
  const m = refHrefPath(h).match(/\/dp\/([A-Za-z0-9]{10})/);
  return m ? m[1].toUpperCase() : "";
}

export function refMatchScore(want: RefDescriptor, cand: RefDescriptor): number {
  let s = 0;
  if (want.tag && want.tag === cand.tag) s += 2;
  if (want.role && want.role === cand.role) s += 1;
  if (want.type && want.type === cand.type) s += 1;
  const wn = normRefText(want.name);
  const cn = normRefText(cand.name);
  if (wn && wn === cn) s += 4;
  else if (wn && cn && wn.length > 3 && (cn.includes(wn) || wn.includes(cn))) s += 2;
  if (want.href && want.href === cand.href) s += 4;
  else if (want.href && cand.href) {
    const wa = refDpAsin(want.href);
    const ca = refDpAsin(cand.href);
    if (wa && ca && wa === ca) s += 5;
    else {
      const wp = refHrefPath(want.href);
      const cp = refHrefPath(cand.href);
      if (wp && wp === cp && wp !== "/") s += 3;
    }
  }
  return s;
}

export function sameBrowserPage(a: string, b: string): boolean {
  try {
    const u = (s: string) => String(s || "").split("#")[0].replace(/\/$/, "");
    return u(a) === u(b);
  } catch {
    return false;
  }
}

const REF_SEL =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [onclick]';

async function waitBrowserQuiet(wsUrl: string, timeout = 2500, quietMs = 450): Promise<void> {
  const expr =
    `((timeout, quietMs) => new Promise((resolve) => {` +
    `let done=false; const finish=(v)=>{ if(!done){ done=true; try{obs.disconnect();}catch{} resolve(v); } };` +
    `let tm=setTimeout(()=>finish(true), quietMs);` +
    `let obs=null;` +
    `try { obs=new MutationObserver(()=>{ clearTimeout(tm); tm=setTimeout(()=>finish(true), quietMs); });` +
    `obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true}); }` +
    `catch(e){ clearTimeout(tm); finish(false); return; }` +
    `setTimeout(()=>finish(false), timeout);` +
    `}))(${timeout | 0},${quietMs | 0})`;
  try {
    await cdpCall(wsUrl, "Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
  } catch {}
}

async function captureBrowserSnapshot(wsUrl: string): Promise<{
  url: string;
  title: string;
  tree: string;
  elements: SnapshotElement[];
}> {
  const v = await evalIsolated(wsUrl, SNAPSHOT_EXPR);
  const elements = (
    Array.isArray(v?.elements) ? v.elements : []
  ).slice(0, MAX_SNAPSHOT_ELEMENTS) as SnapshotElement[];
  const url = String(v?.url || "");
  rememberSnapshotRefs(url, elements);
  return {
    url,
    title: String(v?.title || ""),
    tree: `${String(v?.text || "").slice(0, SNAPSHOT_TEXT_CHARS)}\n\n${formatSnapshotTree(elements)}`,
    elements,
  };
}

// In-page act with its own fallback resolution (parity with auto-mcp
// RESOLVER_SRC): attr tag → exact href → /dp/ASIN → fuzzy name+path. One
// async evaluate does resolve → scroll → settle → re-resolve → prep, so the
// resolve→act race window collapses to a single round-trip.
function buildActRefExpr(ref: string, want: RefDescriptor | undefined, kind: string, text: string): string {
  return (
    `(async (ref, want, SEL, kind, text) => {` +
    `var norm=function(s){return String(s||"").replace(/\\s+/g," ").trim().toLowerCase().slice(0,120);};` +
    `var pathOf=function(h){try{return new URL(String(h||""),location.href).pathname;}catch(e){return String(h||"").split("?")[0];}};` +
    `var asinOf=function(h){var m=pathOf(h).match(/\\/dp\\/([A-Za-z0-9]{10})/);return m?m[1].toUpperCase():"";};` +
    `var rectOf=function(el){try{var r=el.getBoundingClientRect();return (r.width>0||r.height>0)?r:null;}catch(e){return null;}};` +
    `function resolveEl(){` +
    `var tagged=document.querySelector('[data-qube-ref="'+ref+'"]');` +
    `if(tagged&&rectOf(tagged)) return tagged;` +
    `if(want){` +
    `var nodes=Array.from(document.querySelectorAll(SEL)),i,n,h;` +
    `if(want.href){` +
    `for(i=0;i<nodes.length;i++){n=nodes[i];try{if(n.tagName==="A"&&n.getAttribute("href")===want.href&&rectOf(n)) return n;}catch(e){}}` +
    `var wa=asinOf(want.href);` +
    `if(wa){for(i=0;i<nodes.length;i++){n=nodes[i];try{h=n.getAttribute&&n.getAttribute("href");if(h&&asinOf(h)===wa&&rectOf(n)) return n;}catch(e){}}}` +
    `}` +
    `var wn=norm(want.name),best=null,bestScore=0;` +
    `for(i=0;i<nodes.length;i++){n=nodes[i];if(!rectOf(n)) continue;` +
    `var nm="";try{nm=norm(n.getAttribute&&(n.getAttribute("aria-label")||n.innerText||n.value||n.placeholder||n.name||n.id||""));}catch(e){}` +
    `var s=0;` +
    `if(wn&&nm===wn) s+=4;else if(wn&&nm&&wn.length>3&&(nm.indexOf(wn)>=0||wn.indexOf(nm)>=0)) s+=2;` +
    `try{h=n.getAttribute&&n.getAttribute("href");if(want.href&&h&&pathOf(h)===pathOf(want.href)&&pathOf(h)!=="/") s+=3;}catch(e){}` +
    `if(s>bestScore){bestScore=s;best=n;}}` +
    `if(best&&bestScore>=5) return best;` +
    `}` +
    `return null;}` +
    `var el=resolveEl(); if(!el) return {found:false};` +
    `try{el.scrollIntoView({block:"center"});}catch(e){}` +
    `await new Promise(function(r){setTimeout(r,300);});` +
    `el=resolveEl(); if(!el) return {found:false};` +
    `if(kind==="click"){var q=rectOf(el); if(!q) return {found:false}; return {found:true,x:q.left+q.width/2,y:q.top+q.height/2};}` +
    `try{el.focus();}catch(e){}` +
    `if(kind==="fill"&&(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT")){` +
    `try{el.value=text;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return {found:true,set:true};}catch(e){return {found:false};}}` +
    `return {found:true,set:false};` +
    `})(${JSON.stringify(ref)},${JSON.stringify(want ?? null)},${JSON.stringify(REF_SEL)},${JSON.stringify(kind)},${JSON.stringify(text)})`
  );
}

async function healBrowserRef(
  wsUrl: string,
  ref: string
): Promise<{ recovered: boolean; note?: string }> {
  const existsExpr = `(()=>{const el=document.querySelector('[data-qube-ref="${ref}"]');return !!el;})()`;
  try {
    if (await evalIsolated(wsUrl, existsExpr).catch(() => false)) {
      await waitBrowserQuiet(wsUrl, 700, 250);
      if (await evalIsolated(wsUrl, existsExpr).catch(() => false)) return { recovered: false };
    }
  } catch {}
  const want = lastBrowserSnap.refs.get(ref);
  const oldUrl = lastBrowserSnap.url;
  await waitBrowserQuiet(wsUrl);
  const snap = await captureBrowserSnapshot(wsUrl);
  if (!want) {
    throw new Error(
      `Stale ref ${ref}: unknown ref (page changed).\n\nFresh snapshot (use these new refs NOW, same turn — do not stop):\n${snap.tree}`.slice(0, 4500)
    );
  }
  if (!sameBrowserPage(oldUrl, snap.url)) {
    throw new Error(
      `Stale ref ${ref}: page navigated (${oldUrl || "?"} → ${snap.url || "?"}).\n\nFresh snapshot (use these new refs NOW, same turn — do not stop):\n${snap.tree}`.slice(0, 4500)
    );
  }
  let best: SnapshotElement | null = null;
  let bestScore = 0;
  for (const c of snap.elements) {
    const s = refMatchScore(want, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore < 6 || best.idx === undefined) {
    throw new Error(
      `Stale ref ${ref} ("${String(want.name || "").slice(0, 80)}"): element is gone after re-render and no confident match was found.\n\nFresh snapshot (use these new refs NOW, same turn — do not stop):\n${snap.tree}`.slice(0, 4500)
    );
  }
  const retag = `(() => { const nodes=Array.from(document.querySelectorAll(${JSON.stringify(REF_SEL)})); const el=nodes[${Math.max(0, best.idx | 0)}]; if(!el) return false; try{el.setAttribute("data-qube-ref",${JSON.stringify(ref)});}catch{} return true; })()`;
  const ok = await evalIsolated(wsUrl, retag).catch(() => false);
  if (!ok) {
    throw new Error(
      `Stale ref ${ref}: re-match found but re-tagging failed.\n\nFresh snapshot (use these new refs NOW, same turn — do not stop):\n${snap.tree}`.slice(0, 4500)
    );
  }
  return { recovered: true, note: `${ref}→${best.ref} ("${String(best.name || "").slice(0, 60)}")` };
}

/** browser_navigate via CDP Page.navigate. */
export async function browserNavigate(url: string): Promise<{ url: string; title: string } & { fallback?: PixelFallback; error?: string }> {
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) {
    return withBrowserFallback({ url, title: "", fallback: "browser_pixel_act" as const, error: "Page browser is not attached. Use browser_pixel_act on the managed browser window instead." });
  }
  try {
    await cdpCall(target.webSocketDebuggerUrl, "Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 900));
    const v = await evalIsolated(target.webSocketDebuggerUrl, "({title: document.title, url: location.href})").catch(() => null);
    return { url: v?.url || url, title: v?.title || "" };
  } catch (e) {
    return withBrowserFallback({ url, title: "", fallback: "browser_pixel_act" as const, error: e instanceof Error ? e.message : String(e) });
  }
}

/** browser_snapshot via isolated world. */
export async function browserSnapshot(): Promise<{ url: string; title: string; tree: string; elements: SnapshotElement[] } & { fallback?: PixelFallback; error?: string }> {
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) {
    return withBrowserFallback({ url: "", title: "", tree: "", elements: [], fallback: "browser_pixel_act" as const, error: "Page browser is not attached. Use browser_pixel_act instead." });
  }
  try {
    const snap = await captureBrowserSnapshot(target.webSocketDebuggerUrl);
    return { ...snap, url: snap.url || target.url || "" };
  } catch (e) {
    return withBrowserFallback({ url: "", title: "", tree: "", elements: [], fallback: "browser_pixel_act" as const, error: e instanceof Error ? e.message : String(e) });
  }
}

/** browser_act: click/fill/type by ref. Stale refs self-heal in-page
 * (settle → re-snapshot → descriptor re-match → retry, up to 3 attempts per
 * action); the pixel fallback only triggers when healing truly fails. */
export async function browserAct(actions: BrowserActStep[]): Promise<{ ok: boolean; completed: number; uncertain: boolean; url: string; title: string } & { fallback?: PixelFallback; error?: string; tree?: string }> {
  const parsed = parseBrowserActions(actions);
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) {
    return withBrowserFallback({ ok: false, completed: 0, uncertain: true, url: "", title: "", fallback: "browser_pixel_act" as const, error: "Page browser is not attached." });
  }
  const wsUrl = target.webSocketDebuggerUrl;
  let completed = 0;
  try {
    for (const a of parsed) {
      const want0 = lastBrowserSnap.refs.get(a.ref);
      let done = false;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        try {
          await healBrowserRef(wsUrl, a.ref);
          const want = lastBrowserSnap.refs.get(a.ref) || want0;
          const text = "text" in a ? (a as { text: string }).text : "";
          const res = await evalIsolated(
            wsUrl,
            buildActRefExpr(a.ref, want, a.kind, text)
          );
          if (!res?.found) {
            throw new Error(
              `Ref ${a.ref} vanished mid-action (page re-rendered between resolve and act).`
            );
          }
          if (!res?.set && "text" in a) {
            await cdpCall(wsUrl, "Input.insertText", { text: (a as { text: string }).text });
          }
          if (a.kind === "click" && typeof res?.x === "number" && typeof res?.y === "number") {
            // Trusted input events at the resolved point (page JS handlers
            // that ignore synthetic el.click() still fire).
            const x = Math.round(res.x);
            const y = Math.round(res.y);
            await cdpCall(wsUrl, "Input.dispatchMouseEvent", {
              type: "mousePressed", x, y, button: "left", clickCount: 1,
            });
            await cdpCall(wsUrl, "Input.dispatchMouseEvent", {
              type: "mouseReleased", x, y, button: "left", clickCount: 1,
            });
          }
          done = true;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!done) {
        const fresh = await captureBrowserSnapshot(wsUrl).catch(() => null);
        return withBrowserFallback({
          ok: false, completed, uncertain: completed > 0,
          url: fresh?.url || target.url || "", title: fresh?.title || "",
          fallback: "browser_pixel_act" as const,
          tree: fresh?.tree,
          error: `${lastErr instanceof Error ? lastErr.message : String(lastErr)} — confirmed ${completed}/${parsed.length} actions. Take a fresh browser_snapshot and retry the intended action with the new ref in this same turn; do not stop or summarize. Only skip actions already confirmed completed.`,
        });
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
      fallback: "browser_pixel_act" as const,
      error: `${e instanceof Error ? e.message : String(e)} — confirmed ${completed}/${parsed.length} actions. Inspect current state before continuing; never replay completed or uncertain actions.`,
    });
  }
}

// ---------- browser_screenshot / browser_pixel_act (managed browser window only) ----------

let lastFrameId: string | null = null;
let lastFrameBytes: string | null = null;

// Frame byte cache: screenshots travel to the MODEL via tool toModelOutput,
// never inside the JSON text (which would bloat transcripts and get sliced).
// Keyed by frameId so identical-frame dedup ("unchanged") stays byte-free.
const frameBytes = new Map<string, string>();
export function rememberFrame(frameId: string, b64: string): void {
  try {
    frameBytes.set(frameId, b64);
    while (frameBytes.size > 5) {
      const oldest = frameBytes.keys().next().value as string | undefined;
      if (!oldest) break;
      frameBytes.delete(oldest);
    }
  } catch {}
}
export function recallFrame(frameId: string): string | undefined {
  try {
    return frameBytes.get(frameId);
  } catch {
    return undefined;
  }
}

function frameIdFor(jpgBase64: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < jpgBase64.length; i += 7) {
    h ^= jpgBase64.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + "-" + jpgBase64.length;
}

/** browser_screenshot: screenshot of the managed browser window via CDP Page.captureScreenshot (dedup identical frames). */
export async function browserScreenshot(note = "browser observed"): Promise<{ text: string; imageBase64?: string; mimeType?: string; frameId?: string; unchanged?: boolean; error?: string }> {
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
    rememberFrame(frameId, data);
    return { text: `${note}\n${JSON.stringify({ frameId })}`, imageBase64: data, mimeType: "image/jpeg", frameId, unchanged: false };
  } catch (e) {
    return { text: `${note} failed`, error: e instanceof Error ? e.message : String(e) };
  }
}

/** browser_pixel_act: ordered batched x/y actions inside the managed browser window via CDP Input.*. */
export async function browserPixelAct(actions: ComputerAction[], opts?: { observe?: boolean; settleMs?: number }): Promise<{ text: string; imageBase64?: string; completed: number; uncertain: boolean; error?: string }> {
  const parsed = parsePixelActions(actions);
  const target = await getPageTarget();
  if (!target?.webSocketDebuggerUrl) return { text: "browser_pixel_act: no live browser target", completed: 0, uncertain: true, error: "no live target" };
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
        const { code, windowsVirtualKeyCode, text } = describeKey(a.key);
        const modifiers = modifiersBitmask(a.modifiers);
        const base = { key: a.key, code, windowsVirtualKeyCode, modifiers, ...(text ? { text } : {}) };
        await cdpCall(wsUrl, "Input.dispatchKeyEvent", { ...base, type: "keyDown" });
        // Printable single chars also need rawKeyDown for some pages; keyDown is enough for most.
        await cdpCall(wsUrl, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
      } else if (a.kind === "scroll") {
        await cdpCall(wsUrl, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 450, deltaX: 0, deltaY: a.direction === "down" ? 120 * a.amount : -120 * a.amount });
      } else if (a.kind === "wait") {
        await new Promise((r) => setTimeout(r, a.ms));
      }
      completed++;
    }
    // Rakazo parity: batch predictable actions with observe:false; observe by default.
    if (opts?.observe === false) {
      return { text: `browser_pixel_act confirmed ${completed}/${parsed.length} actions (observe:false — no screenshot).`, completed, uncertain: false };
    }
    // Rakazo parity: settle_ms lets the page settle before the screenshot.
    const settleMs = Math.min(Math.max(Math.round(Number(opts?.settleMs) || 0), 0), 5000);
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    const obs = await browserScreenshot("browser_pixel_act result");
    return { text: obs.text, imageBase64: obs.imageBase64, completed, uncertain: false };
  } catch (e) {
    return {
      text: `browser_pixel_act confirmed ${completed}/${parsed.length} actions. Inspect current state before continuing; never replay completed or uncertain actions.`,
      completed, uncertain: true, error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** @deprecated Use browserScreenshot — old computer_observe name kept for back-compat. */
export const computerObserve = browserScreenshot;
/** @deprecated Use browserPixelAct — old computer_act name kept for back-compat. */
export const computerAct = browserPixelAct;

// ---------- Browser lease (single-window claim, Rakazo computer-screens parity) ----------

const SCREEN_BUSY = "The browser window is temporarily busy. Retry in a moment. File and shell tools still work.";

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

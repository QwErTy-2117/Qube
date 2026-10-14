import type { PageFingerprint } from "./types";

export interface ConsoleEntry { type: string; text: string; url?: string; line?: number }
export interface NetworkFailure { url: string; errorText: string; status?: number }
export interface PageObservation extends PageFingerprint {
  consoleErrors: ConsoleEntry[];
  networkFailures: NetworkFailure[];
}

export function hashText(s: string): string {
  let h = 0x811c9dc5;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const EXPR = `(() => {
  try {
    const text = (document.body ? document.body.innerText : "") || "";
    const dialog = !!document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
    const errs = (window.__qubeConsoleErrors || []).slice(-8).map((e) => ({ type: String(e.type || "error").slice(0,20), text: String(e.text || "").slice(0,300), url: String(e.url || "").slice(0,300), line: Number(e.line || 0) || 0 }));
    const nets = (window.__qubeNetFailures || []).slice(-8).map((n) => ({ url: String(n.url || "").slice(0,300), errorText: String(n.errorText || "").slice(0,200), status: Number(n.status || 0) || 0 }));
    return { title: document.title || "", url: location.href || "", text: text.slice(0, 4000), dialog, consoleErrors: errs, networkFailures: nets };
  } catch (e) { return { error: String((e && e.message) || e) }; }
})()`;

const HOOK_EXPR = `(() => {
  try {
    if (window.__qubeObserversInstalled) return true;
    window.__qubeObserversInstalled = true;
    window.__qubeConsoleErrors = window.__qubeConsoleErrors || [];
    window.__qubeNetFailures = window.__qubeNetFailures || [];
    const pushErr = (type, text, url, line) => {
      try {
        window.__qubeConsoleErrors.push({ type, text: String(text).slice(0, 300), url: String(url || "").slice(0, 300), line: Number(line || 0) || 0 });
        if (window.__qubeConsoleErrors.length > 20) window.__qubeConsoleErrors.splice(0, window.__qubeConsoleErrors.length - 20);
      } catch {}
    };
    const origError = console.error.bind(console);
    console.error = (...a) => { try { pushErr("error", a.map(String).join(" ").slice(0, 300), location.href, 0); } catch {} try { return origError(...a); } catch {} };
    window.addEventListener("error", (ev) => { pushErr("error", String((ev && ev.message) || "window.onerror").slice(0, 300), String((ev && ev.filename) || location.href).slice(0, 300), Number((ev && ev.lineno) || 0) || 0); }, true);
    window.addEventListener("unhandledrejection", (ev) => { let t = ""; try { t = String((ev && ev.reason && (ev.reason.stack || ev.reason.message)) || ev.reason || "unhandledrejection"); } catch {} pushErr("unhandledrejection", t.slice(0, 300), location.href, 0); }, true);
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
      window.fetch = (...a) => origFetch(...a).then((res) => {
        try {
          if (!res.ok) {
            window.__qubeNetFailures.push({ url: String(typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || location.href).slice(0, 300), errorText: ("HTTP " + res.status).slice(0, 100), status: res.status });
            if (window.__qubeNetFailures.length > 20) window.__qubeNetFailures.splice(0, window.__qubeNetFailures.length - 20);
          }
        } catch {}
        return res;
      }, (err) => {
        try {
          window.__qubeNetFailures.push({ url: String(typeof a[0] === "string" ? a[0] : location.href).slice(0, 300), errorText: String((err && err.message) || err).slice(0, 200), status: 0 });
          if (window.__qubeNetFailures.length > 20) window.__qubeNetFailures.splice(0, window.__qubeNetFailures.length - 20);
        } catch {}
        throw err;
      });
    }
    return true;
  } catch { return false; }
})()`;

type Cdp = (wsUrl: string, method: string, params?: Record<string, unknown>) => Promise<any>;

export interface ObserverCdp {
  getPageTarget: () => Promise<{ webSocketDebuggerUrl?: string } | null>;
  cdpCall: Cdp;
  evalIsolated: (wsUrl: string, expression: string) => Promise<any>;
}

export async function observePage(cdp: ObserverCdp, timeoutMs = 8000): Promise<PageObservation | null> {
  try {
    const target = await cdp.getPageTarget();
    const wsUrl = target?.webSocketDebuggerUrl;
    if (!wsUrl) return null;
    try { await cdp.evalIsolated(wsUrl, HOOK_EXPR); } catch {}
    const v = await cdp.cdpCall(wsUrl, "Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true })
      .then((r: any) => r?.result?.value)
      .catch(() => null);
    if (!v || typeof v !== "object" || (v as any).error) return null;
    const text = String((v as any).text || "");
    return {
      at: Date.now(),
      url: String((v as any).url || ""),
      title: String((v as any).title || ""),
      textHash: hashText(text),
      textLen: text.length,
      dialog: !!(v as any).dialog,
      consoleErrors: Array.isArray((v as any).consoleErrors) ? (v as any).consoleErrors : [],
      networkFailures: Array.isArray((v as any).networkFailures) ? (v as any).networkFailures : [],
    };
  } catch { return null; }
}

export interface RefDescription {
  label: string | null;
  disabled: boolean;
  visible: boolean;
}

export async function describeRef(cdp: ObserverCdp, ref: string): Promise<RefDescription | null> {
  try {
    if (!/^e\d+$/.test(ref)) return null;
    const target = await cdp.getPageTarget();
    const wsUrl = target?.webSocketDebuggerUrl;
    if (!wsUrl) return null;
    const expr = `(() => { const el = document.querySelector('[data-qube-ref="${ref}"]'); if (!el) return null; const role = el.getAttribute("role") || el.tagName.toLowerCase(); const name = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("name") || el.id || role || "").toString().replace(/\\s+/g, " ").trim().slice(0, 120); let rect = null; try { rect = el.getBoundingClientRect(); } catch {} const visible = !!(rect && (rect.width > 0 || rect.height > 0)); let disabled = false; try { disabled = !!el.disabled || String(el.getAttribute("aria-disabled") || "").toLowerCase() === "true"; } catch {} return { label: role + ' "' + name + '"', disabled, visible }; })()`;
    const v = await cdp.evalIsolated(wsUrl, expr).catch(() => null);
    if (!v || typeof v !== "object") return null;
    return {
      label: typeof (v as any).label === "string" && (v as any).label ? (v as any).label : null,
      disabled: !!(v as any).disabled,
      visible: (v as any).visible !== false,
    };
  } catch { return null; }
}

export async function resolveRefLabel(cdp: ObserverCdp, ref: string): Promise<string | null> {
  const d = await describeRef(cdp, ref);
  return d?.label ?? null;
}

export function withConsoleNetworkSignals(signals: string[], obs: PageObservation | null): string[] {
  if (!obs) return signals;
  const out = [...signals];
  if (obs.consoleErrors.length > 0 && !out.includes("console_errors")) out.push("console_errors");
  if (obs.networkFailures.length > 0 && !out.includes("network_errors")) out.push("network_errors");
  return out;
}

/**
 * Condensed, model-facing rendering of the probe's captured page errors.
 * Bounded (6 lines, each short) so it can ride along on _kernel without
 * bloating the transcript — the model gets the actual failing URL, status,
 * and message instead of a bare "network_errors" flag it cannot act on.
 */
export function summarizePageErrors(
  obs: Pick<PageObservation, "consoleErrors" | "networkFailures"> | null | undefined,
  maxEach = 3,
): string[] {
  try {
    if (!obs) return [];
    const out: string[] = [];
    for (const e of (obs.consoleErrors || []).slice(-maxEach)) {
      const where = e.url ? ` (${String(e.url).slice(0, 120)}${e.line ? `:${e.line}` : ""})` : "";
      out.push(`console ${String(e.type || "error").slice(0, 20)}: ${String(e.text || "").slice(0, 160)}${where}`);
    }
    for (const n of (obs.networkFailures || []).slice(-maxEach)) {
      const status = n.status ? `HTTP ${n.status} ` : "";
      out.push(`network ${status}${String(n.errorText || "").slice(0, 100)} ${String(n.url || "").slice(0, 160)}`.trim());
    }
    return out.slice(0, maxEach * 2);
  } catch { return []; }
}

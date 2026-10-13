/**
 * Generative UI sandbox helpers (OpenIntelligentUI pattern, Qube-styled).
 *
 * Pure functions with no DOM/JSX dependencies so they can be unit-tested
 * in Node. The renderer component (`generative-ui-tool-ui.tsx`) imports
 * `buildSrcDoc` and injects the result into a `sandbox="allow-scripts"`
 * iframe (no same-origin, no top navigation).
 */

export type GenerativeUIKind =
  | "calculator"
  | "chart"
  | "table"
  | "explanation"
  | "planner"
  | "map"
  | "custom";

export type GenerativeUIArgs = {
  title?: string;
  kind?: GenerativeUIKind;
  html?: string;
  css?: string;
  js?: string;
  height?: number;
  label?: string;
};

export const GENERATIVE_UI_LIMITS = {
  html: 60000,
  css: 20000,
  js: 60000,
  heightMin: 120,
  heightMax: 900,
  titleMax: 120,
} as const;

export function clampHeight(n: unknown, fallback = 320): number {  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(
    GENERATIVE_UI_LIMITS.heightMax,
    Math.max(GENERATIVE_UI_LIMITS.heightMin, Math.round(v)),
  );
}

/**
 * Parse an inline ```genui fenced block (JSON with at least an `html`
 * string) into tool args. Returns null when the fence isn't valid —
 * callers fall back to rendering it as a plain code block so no content
 * is ever lost.
 */
export function parseGenerativeUIFence(text: string): GenerativeUIArgs | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const html = (parsed as Record<string, unknown>).html;
    if (typeof html !== "string" || !html.trim()) return null;
    return parsed as GenerativeUIArgs;
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth scrub for model-authored sandbox scripts. The iframe
 * itself is sandboxed (`allow-scripts` only), so these replacements only
 * guard against confusing failures — never the primary boundary.
 */
export function stripDangerousJs(js: string): string {
  return js
    .replace(/top\s*\.\s*location/gi, "void 0 /* blocked: top navigation */")
    .replace(/parent\s*\.\s*location/gi, "void 0 /* blocked: parent navigation */")
    .replace(/window\s*\.\s*top/gi, "window /* blocked: frame escape */")
    .replace(/window\s*\.\s*parent/gi, "window /* blocked: frame escape */")
    .replace(/localStorage/gi, "void 0 /* blocked: storage */")
    .replace(/sessionStorage/gi, "void 0 /* blocked: storage */")
    .replace(/indexedDB/gi, "void 0 /* blocked: storage */")
    .replace(/XMLHttpRequest/gi, "void 0 /* blocked: XHR */")
    .replace(/fetch\s*\(/gi, "void /* blocked: network */ (");
}

/**
 * Build a self-contained HTML document for the sandboxed iframe.
 * Injects Qube theme tokens (light/dark via `prefers-color-scheme`) so
 * generated UI reads as native Qube — the model must use
 * `var(--background)`, `var(--foreground)`, `var(--muted)`,
 * `var(--border)`, `var(--primary)`, `var(--radius)`.
 */
export function buildSandboxSrcDoc(args: GenerativeUIArgs): string {
  const css =
    typeof args.css === "string"
      ? args.css.slice(0, GENERATIVE_UI_LIMITS.css)
      : "";
  const html =
    typeof args.html === "string"
      ? args.html.slice(0, GENERATIVE_UI_LIMITS.html)
      : "";
  const js =
    typeof args.js === "string"
      ? stripDangerousJs(args.js).slice(0, GENERATIVE_UI_LIMITS.js)
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
:root {
  color-scheme: light dark;
  --radius: 0.625rem;
  --background: #ffffff;
  --foreground: #171717;
  --muted: #f0f0f0;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --primary: #171717;
  --primary-foreground: #fafafa;
  --accent: #f5f5f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0f0f0f;
    --foreground: #fafafa;
    --muted: #1e1e1e;
    --muted-foreground: #a3a3a3;
    --border: rgba(255,255,255,0.12);
    --primary: #e7e7e7;
    --primary-foreground: #171717;
    --accent: #232323;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 12px;
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
  background: var(--background);
  color: var(--foreground);
  font-size: 14px;
  line-height: 1.5;
}
button, input, select, textarea { font: inherit; }
button {
  border: 1px solid var(--border);
  background: var(--muted);
  color: var(--foreground);
  border-radius: calc(var(--radius) - 2px);
  padding: 6px 12px;
  cursor: pointer;
}
button:hover { filter: brightness(0.97); }
input, select, textarea {
  border: 1px solid var(--border);
  background: var(--background);
  color: var(--foreground);
  border-radius: calc(var(--radius) - 2px);
  padding: 6px 10px;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
th { background: var(--muted); font-weight: 600; }
${css}
</style>
</head>
<body>
${html || '<p style="color:var(--muted-foreground)">Empty visual.</p>'}
<script>
(function() {
  "use strict";
  // Local-only interactivity: no network, no storage, no top navigation.
  // A follow-up bridge is exposed as window.qube.sendPrompt(text) — the
  // host appends it as a new user turn (same role as OpenIntelligentUI's
  // host bridge, but minimal and validated).
  window.qube = {
    sendPrompt: function(text) {
      try {
        var msg = String(text || "").slice(0, 2000);
        window.parent.postMessage({ __qubeGenerativeUI: true, text: msg }, "*");
      } catch (e) {}
    },
    openLink: function(url) {
      try {
        var u = String(url || "");
        if (/^https:\\/\\//i.test(u)) window.open(u, "_blank", "noopener");
      } catch (e) {}
    }
  };
  function height() {
    try {
      var h = document.documentElement.scrollHeight || document.body.scrollHeight || 200;
      window.parent.postMessage({ __qubeGenerativeUIHeight: true, height: Math.min(1200, Math.max(80, h)) }, "*");
    } catch (e) {}
  }
  window.addEventListener("load", function() { setTimeout(height, 50); setTimeout(height, 500); });
  try {
    if (typeof ResizeObserver !== "undefined" && document.body) {
      var ro = new ResizeObserver(function() { height(); });
      ro.observe(document.body);
    }
  } catch (e) {}
  try {
    ${js}
  } catch (err) {
    var pre = document.createElement("pre");
    pre.style.cssText = "color:var(--muted-foreground);font-size:12px;white-space:pre-wrap";
    pre.textContent = "Interactive script error: " + (err && err.message ? err.message : err);
    document.body.appendChild(pre);
  }
  setTimeout(height, 100);
})();
</script>
</body>
</html>`;
}

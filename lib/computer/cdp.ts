/**
 * Minimal Chrome DevTools Protocol client for the computer's browser.
 *
 * The agent needs to read and act on pages in the SAME browser the user
 * sees (same profile, same cookies), so page operations go through CDP on
 * the running instance instead of a second fetcher with its own session.
 * Every call attaches to the existing page target, does its work and
 * detaches; no long-lived state is kept.
 */

import WebSocket from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getComputerPaths } from "./paths";

const CALL_TIMEOUT_MS = 20_000;

type Send = (method: string, params?: Record<string, unknown>) => Promise<any>;

async function pageWebSocketUrl(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Browser endpoint unavailable (${res.status})`);
  const info = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!info.webSocketDebuggerUrl) throw new Error("Browser did not expose a DevTools WebSocket URL");
  return info.webSocketDebuggerUrl;
}

/** Run `fn` against the first page target, then detach. */
async function withPage<T>(port: number, fn: (send: Send, targetId: string) => Promise<T>): Promise<T> {
  const ws = new WebSocket(await pageWebSocketUrl(port), { maxPayload: 64 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out connecting to the browser")), 5000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  let nextId = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  ws.on("message", (raw: WebSocket.RawData) => {
    let message: any;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message?.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message || "CDP error"));
    else waiter.resolve(message.result);
  });

  const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, CALL_TIMEOUT_MS);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });

  try {
    const { targetInfos } = await call("Target.getTargets");
    const page = (targetInfos as Array<{ type: string; targetId: string }>).find((t) => t.type === "page");
    const targetId = page?.targetId ?? (await call("Target.createTarget", { url: "about:blank" })).targetId;
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    return await fn((method, params) => call(method, params ?? {}, sessionId), targetId as string);
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

async function evaluate<T = any>(send: Send, expression: string): Promise<T> {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "Page script failed");
  }
  return result?.result?.value as T;
}

export type PageSnapshot = { url: string; title: string; text: string; truncated: boolean };

export async function readBrowserPage(port: number, maxChars = 20_000): Promise<PageSnapshot> {
  return withPage(port, async (send) => {
    const data = await evaluate<{ url: string; title: string; text: string }>(
      send,
      `(() => ({
        url: location.href,
        title: document.title || "",
        text: (document.body && document.body.innerText) || ""
      }))()`,
    );
    const text = (data?.text ?? "").trim();
    return {
      url: data?.url ?? "",
      title: data?.title ?? "",
      text: text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text,
      truncated: text.length > maxChars,
    };
  });
}

export async function navigateBrowser(port: number, url: string): Promise<PageSnapshot> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withPage(port, async (send) => {
    await send("Page.enable");
    await send("Page.navigate", { url: target });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const state = await evaluate<string>(send, "document.readyState");
      if (state === "complete") break;
      await new Promise((r) => setTimeout(r, 150));
    }
    const data = await evaluate<{ url: string; title: string; text: string }>(
      send,
      `(() => ({ url: location.href, title: document.title || "", text: (document.body && document.body.innerText) || "" }))()`,
    );
    const text = (data?.text ?? "").trim();
    return {
      url: data?.url ?? target,
      title: data?.title ?? "",
      text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n…(truncated)` : text,
      truncated: text.length > 20_000,
    };
  });
}

export type BrowserActionOutcome = { ok: boolean; detail: string };

/** Click an element by CSS selector, or by visible text as a fallback. */
export async function clickBrowserElement(port: number, target: { selector?: string; text?: string }): Promise<BrowserActionOutcome> {
  const selector = JSON.stringify(target.selector ?? null);
  const text = JSON.stringify(target.text ?? null);
  return withPage(port, async (send) =>
    evaluate<BrowserActionOutcome>(
      send,
      `(() => {
        const selector = ${selector};
        const text = ${text};
        const candidates = selector
          ? [document.querySelector(selector)]
          : Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],[onclick]'));
        const el = selector
          ? candidates[0]
          : candidates.find((node) => {
              const label = ((node.innerText || node.value || node.getAttribute('aria-label') || '') + '').trim().toLowerCase();
              return text && label.includes(String(text).toLowerCase());
            });
        if (!el) return { ok: false, detail: selector ? 'No element matched ' + selector : 'No clickable element matched ' + text };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true, detail: 'Clicked ' + el.tagName.toLowerCase() + (el.innerText ? ' "' + el.innerText.trim().slice(0, 60) + '"' : '') };
      })()`,
    ),
  );
}

/** Set a field's value the way a user would, so frameworks observe it. */
export async function typeBrowserElement(port: number, input: { selector: string; text: string }): Promise<BrowserActionOutcome> {
  return withPage(port, async (send) =>
    evaluate<BrowserActionOutcome>(
      send,
      `(() => {
        const el = document.querySelector(${JSON.stringify(input.selector)});
        if (!el) return { ok: false, detail: 'No element matched ' + ${JSON.stringify(input.selector)} };
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ${JSON.stringify(input.text)});
        else el.value = ${JSON.stringify(input.text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, detail: 'Typed into ' + el.tagName.toLowerCase() };
      })()`,
    ),
  );
}

const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
};

export async function pressBrowserKey(port: number, key: string): Promise<BrowserActionOutcome> {
  const spec = KEYS[key];
  if (!spec) return { ok: false, detail: `Unsupported key: ${key}. Supported: ${Object.keys(KEYS).join(", ")}` };
  return withPage(port, async (send) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode });
    if (spec.text) await send("Input.dispatchKeyEvent", { type: "char", key: spec.key, text: spec.text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode });
    return { ok: true, detail: `Pressed ${key}` };
  });
}

/** Capture the visible page into the computer's downloads folder. */
export async function screenshotBrowser(port: number, name = "screenshot.png"): Promise<{ path: string; bytes: number }> {
  const data = await withPage(port, async (send) => send("Page.captureScreenshot", { format: "png" }));
  const buffer = Buffer.from(String(data?.data ?? ""), "base64");
  if (buffer.length === 0) throw new Error("Browser returned an empty screenshot");
  const paths = getComputerPaths();
  await mkdir(paths.downloads, { recursive: true });
  const target = join(paths.downloads, name.endsWith(".png") ? name : `${name}.png`);
  await writeFile(target, buffer);
  return { path: target, bytes: buffer.length };
}

/**
 * Persistent browser session: the tabs the agent (or user) leaves open
 * are snapshotted before MCP disconnects and reopened on the next
 * launch — across chats, runs, and app restarts. Cookies/history live
 * in the profile dir already; this preserves the open pages too.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { getBrowserPort } from "./managed-chrome";

const MAX_TABS = 10;

function tabsFilePath(): string {
  return join(getDataDir(), ".memory", "browser-tabs.json");
}

function isStorableUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url)) return false;
  return true;
}

async function listTargets(): Promise<Array<{ id: string; type: string; url: string }>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`http://127.0.0.1:${getBrowserPort()}/json/list`, { signal: ctrl.signal });
    if (!res.ok) return [];
    return (await res.json()) as Array<{ id: string; type: string; url: string }>;
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Snapshot current http(s) tabs to disk. Call BEFORE MCP disconnect. */
export async function snapshotBrowserTabs(): Promise<void> {
  try {
    const targets = await listTargets();
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const t of targets) {
      if (t.type !== "page" || !isStorableUrl(t.url)) continue;
      if (seen.has(t.url)) continue;
      seen.add(t.url);
      urls.push(t.url);
      if (urls.length >= MAX_TABS) break;
    }
    const file = tabsFilePath();
    const dir = join(getDataDir(), ".memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ urls, savedAt: Date.now() }, null, 2), "utf-8");
    if (urls.length > 0) console.log(`[browser-tabs] Snapshotted ${urls.length} tab(s)`);
  } catch (e) {
    console.warn("[browser-tabs] Snapshot failed:", (e as Error)?.message || String(e));
  }
}

function loadSavedTabs(): string[] {
  try {
    const file = tabsFilePath();
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, "utf-8"));
    if (!Array.isArray(data?.urls)) return [];
    return data.urls.filter((u: unknown): u is string => typeof u === "string" && isStorableUrl(u)).slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

/** Reopen saved tabs missing from the live browser. Runs on ensure. */
export async function restoreBrowserTabs(): Promise<void> {
  try {
    const saved = loadSavedTabs();
    if (saved.length === 0) return;
    const live = await listTargets();
    const liveUrls = new Set(live.map((t) => t.url));
    const missing = saved.filter((u) => !liveUrls.has(u));
    if (missing.length === 0) return;
    console.log(`[browser-tabs] Restoring ${missing.length} tab(s)`);
    for (const url of missing) {
      try {
        // DevTools API takes the raw URL as the query string (not ?url=).
        await fetch(`http://127.0.0.1:${getBrowserPort()}/json/new?${encodeURI(url)}`, { method: "PUT" });
        await new Promise((r) => setTimeout(r, 150));
      } catch {}
    }
  } catch (e) {
    console.warn("[browser-tabs] Restore failed:", (e as Error)?.message || String(e));
  }
}

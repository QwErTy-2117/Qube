/**
 * Managed Chromium for the agent's browser tools.
 *
 * The agent drives this browser through @playwright/mcp via
 * --cdp-endpoint, while the app mirrors it live into the Browser side
 * panel (CDP screencast) — and the user can click/type/scroll right in
 * the panel (CDP input forwarding).
 *
 * Runs HEADLESS by default so there is no separate OS window: the side
 * panel IS the browser window. Set BROWSER_HEADED=1 to show the OS
 * window instead (useful on bot-walled sites).
 * BROWSER_HEADLESS=0 is accepted as an alias of BROWSER_HEADED=1.
 *
 * - One shared instance, launched lazily and kept alive across tool
 *   calls and chat runs. It is NEVER closed when a run finishes — only
 *   the user closing the app (or server shutdown) stops it.
 * - Falls back to null when no Chrome binary is found, so callers can
 *   degrade to a standalone MCP launch.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export const BROWSER_CDP_PORT = parseInt(process.env.BROWSER_CDP_PORT || "9222", 10);

type ManagedBrowser = {
  port: number;
  endpoint: string;
  pid: number;
};

let browserProc: ReturnType<typeof spawn> | null = null;
let ensurePromise: Promise<ManagedBrowser> | null = null;
let activePort: number = BROWSER_CDP_PORT;
let weOwnProc = false;

/** The CDP port currently in use (adopted instances may differ). */
export function getBrowserPort(): number {
  return activePort;
}

function profileDir(): string {
  return join(getDataDir(), ".browser-profile");
}

/**
 * Adopt a live Chromium already holding our profile (e.g. previous
 * server incarnation): read its DevToolsActivePort and probe it.
 */
async function tryAdoptExisting(): Promise<ManagedBrowser | null> {
  try {
    const portFile = join(profileDir(), "DevToolsActivePort");    const raw = readFileSync(portFile, "utf-8").split("\n")[0]?.trim();
    const port = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(port) || port <= 0) return null;
    await waitForEndpoint(port, 3000);
    activePort = port;
    weOwnProc = false;
    console.log(`[managed-chrome] Adopted running Chromium on port ${port}`);
    return { port, endpoint: `http://127.0.0.1:${port}`, pid: 0 };
  } catch {
    return null;
  }
}

/** Clear stale single-instance lock files left by killed launches. */
function clearStaleLocks(): void {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      unlinkSync(join(profileDir(), name));
    } catch {}
  }
}

function candidateBinaries(): string[] {
  const fromEnv = process.env.CHROME_PATH;
  const home = homedir();
  const list: string[] = [];
  if (fromEnv) list.push(fromEnv);
  if (platform() === "win32") {
    list.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      join(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe")
    );
  } else if (platform() === "darwin") {
    list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    list.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/opt/google/chrome/chrome",
      "/snap/bin/chromium"
    );
  }
  // Playwright's bundled Chromium (headed-capable full build, not headless_shell).
  try {
    const cache = join(home, ".cache", "ms-playwright");
    const entries = readdirSync(cache);
    for (const e of entries) {
      if (!e.startsWith("chromium-") || e.includes("headless")) continue;
      if (platform() === "win32") list.push(join(cache, e, "chrome-win", "chrome.exe"));
      else if (platform() === "darwin") list.push(join(cache, e, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"));
      else {
        // Newer Playwright builds use chrome-linux64, older use chrome-linux.
        list.push(join(cache, e, "chrome-linux", "chrome"));
        list.push(join(cache, e, "chrome-linux64", "chrome"));
      }
    }
  } catch {}
  return list;
}

export function findChromeBinary(): string | null {
  for (const p of candidateBinaries()) {
    try {
      if (p && existsSync(p)) return p;
    } catch {}
  }
  return null;
}

async function waitForEndpoint(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Chrome DevTools endpoint did not respond on port ${port} within ${timeoutMs}ms`);
}

function installShutdownHooks() {
  const kill = () => {
    // Only kill processes we launched; adopted ones belong to someone else.
    if (!weOwnProc) {
      browserProc = null;
      ensurePromise = null;
      return;
    }
    try {
      browserProc?.kill();
    } catch {}
    browserProc = null;
    ensurePromise = null;
  };
  try {
    process.on("SIGTERM" as any, kill);
    process.on("SIGINT" as any, kill);
    process.on("beforeExit" as any, kill);
  } catch {}
}

let hooksInstalled = false;

/**
 * Launch (or reuse) the shared headed Chromium. Resolves with the CDP
 * http endpoint. Never rejects with a process leak: failed launches
 * reset state so the next call retries.
 */
export function ensureManagedChrome(): Promise<ManagedBrowser> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    if (browserProc && !browserProc.killed && browserProc.exitCode === null) {
      try {
        await waitForEndpoint(activePort, 3000);
        return { port: activePort, endpoint: `http://127.0.0.1:${activePort}`, pid: browserProc.pid ?? 0 };
      } catch {
        try { browserProc.kill(); } catch {}
        browserProc = null;
      }
    }
    // Reuse a live Chromium from a previous incarnation when possible.
    const adopted = await tryAdoptExisting();
    if (adopted) {
      try {
        const { restoreBrowserTabs } = await import("./tabs");
        await restoreBrowserTabs();
      } catch {}
      try {
        const { noteBrowserReady } = await import("./screencast");
        noteBrowserReady();
      } catch {}
      return adopted;
    }
    const binary = findChromeBinary();
    if (!binary) {
      throw new Error(
        "No Chrome/Chromium binary found (set CHROME_PATH or install Chrome / `npx playwright install chromium`)."
      );
    }
    const dir = profileDir();
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    } catch {}
    clearStaleLocks();

    if (!hooksInstalled) {
      hooksInstalled = true;
      installShutdownHooks();
    }

    const headed =
      process.env.BROWSER_HEADED === "1" || process.env.BROWSER_HEADLESS === "0";
    activePort = BROWSER_CDP_PORT;
    const args = [
      `--remote-debugging-port=${activePort}`,
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "--no-default-browser-check",
      // Playwright launches Chromium unsandboxed by default; match that
      // (sandboxed launches crash in minimal containers).
      "--no-sandbox",
      "--disable-features=Translate",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      // Headless by default: the side panel is the only window.
      ...(headed ? ["--start-maximized"] : ["--headless=new", "--disable-gpu", "--window-size=1280,900"]),
      "about:blank",
    ];
    console.log(`[managed-chrome] Launching ${headed ? "headed" : "headless"} Chromium: ${binary}`);
    const proc = spawn(binary, args, {
      // Inherit stdin as ignored; capture stderr for launch diagnostics.
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
      env: { ...process.env } as NodeJS.ProcessEnv,
    });
    browserProc = proc;
    weOwnProc = true;
    let stderrTail = "";
    try {
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });
    } catch {}
    proc.on("exit", (code, signal) => {
      console.warn(`[managed-chrome] Exited code=${code} signal=${signal} — next use will relaunch`);
      if (browserProc === proc) {
        browserProc = null;
        ensurePromise = null;
      }
    });
    proc.on("error", (e) => {
      console.error("[managed-chrome] Spawn error:", (e as Error).message);
      if (browserProc === proc) {
        browserProc = null;
        ensurePromise = null;
      }
    });

    await waitForEndpoint(activePort, 25000).catch((e) => {
      const detail = stderrTail.trim().slice(-800);
      try { proc.kill(); } catch {}
      throw new Error(
        `${(e as Error)?.message || String(e)}${detail ? ` | chrome stderr: ${detail}` : ""}`
      );
    });
    console.log(`[managed-chrome] Ready on port ${activePort} (pid ${proc.pid})`);
    // Reopen the tabs from last time (stored session survives restarts).
    try {
      const { restoreBrowserTabs } = await import("./tabs");
      await restoreBrowserTabs();
    } catch {}
    // Notify screencast layer (lazy import to avoid cycles).
    try {
      const { noteBrowserReady } = await import("./screencast");
      noteBrowserReady();
    } catch {}
    return { port: activePort, endpoint: `http://127.0.0.1:${activePort}`, pid: proc.pid ?? 0 };
  })();

  ensurePromise.catch(() => {
    // Allow retries after failure.
    ensurePromise = null;
  });
  return ensurePromise;
}

/** Best-effort warm-up at server boot (never throws). */
export function warmManagedChrome(): void {
  ensureManagedChrome().catch((e) => {
    console.warn("[managed-chrome] Warm-up failed (will retry on demand):", (e as Error)?.message || String(e));
  });
}

export type BrowserStatus = {
  running: boolean;
  listening: boolean;
  pid: number;
  port: number;
  endpoint: string;
};

/** Point-in-time health for diagnostics UI. */
export async function getBrowserStatus(): Promise<BrowserStatus> {
  const procAlive =
    !!browserProc && !browserProc.killed && (browserProc.exitCode === null || browserProc.exitCode === undefined);
  let listening = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${activePort}/json/version`, { signal: ctrl.signal });
    clearTimeout(t);
    listening = res.ok;
  } catch {}
  return {
    running: procAlive || listening,
    listening,
    pid: procAlive ? (browserProc?.pid ?? 0) : 0,
    port: activePort,
    endpoint: `http://127.0.0.1:${activePort}`,
  };
}

/** Kill the managed browser and reset state so the next use relaunches. */
export async function restartManagedChrome(): Promise<BrowserStatus> {
  if (weOwnProc) {
    try {
      browserProc?.kill();
    } catch {}
  }
  browserProc = null;
  weOwnProc = false;
  ensurePromise = null;
  try {
    const { resetBrowserArgsCache } = await import("@/lib/pi/browser-mcp");
    resetBrowserArgsCache();
  } catch {}
  try {
    await ensureManagedChrome();
  } catch (e) {
    console.warn("[managed-chrome] Restart relaunch failed:", (e as Error)?.message || String(e));
  }
  return getBrowserStatus();
}

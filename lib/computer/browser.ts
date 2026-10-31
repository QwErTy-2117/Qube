/**
 * The computer's browser: Chromium driven by Qube, with its profile inside
 * the runtime.
 *
 * Persistence is the whole point: `--user-data-dir` points at
 * `.computer/browser/profile`, so cookies, logins and the session store
 * survive restarts, and downloads land in `.computer/downloads`. The
 * profile is never deleted unless the user resets the computer.
 *
 * Lifecycle is lazy: nothing launches until a tool or the panel asks for a
 * page, so an idle computer costs no process. An already-running Chromium
 * that owns our profile is adopted (DevToolsActivePort) instead of being
 * duplicated.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { ensureComputerDirs, appendActivity } from "./session";
import { getComputerPaths, type ComputerPaths } from "./paths";

export const DEFAULT_BROWSER_PORT = parseInt(process.env.QUBE_COMPUTER_BROWSER_PORT || "9223", 10);

let browserProc: ChildProcess | null = null;
let ensurePromise: Promise<ComputerBrowser> | null = null;
let activePort = DEFAULT_BROWSER_PORT;

export type ComputerBrowser = { endpoint: string; port: number; pid: number; adopted: boolean };

function candidateBinaries(): string[] {
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (platform() === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (platform() === "win32") {
    return [
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      join(local, "Chromium", "Application", "chrome.exe"),
      join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
}

export function findBrowserBinary(): string | null {
  const explicit = process.env.CHROME_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of candidateBinaries()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function endpointReady(port: number, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/** Reuse a Chromium that is already holding our profile. */
async function adoptExisting(paths: ComputerPaths): Promise<ComputerBrowser | null> {
  try {
    const raw = readFileSync(join(paths.browserProfile, "DevToolsActivePort"), "utf-8").split("\n")[0]?.trim();
    const port = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(port) || port <= 0) return null;
    if (!(await endpointReady(port, 2500))) return null;
    activePort = port;
    return { endpoint: `http://127.0.0.1:${port}`, port, pid: 0, adopted: true };
  } catch {
    return null;
  }
}

export type ComputerBrowserStatus = {
  available: boolean;
  binary: string | null;
  running: boolean;
  port: number;
  profileDir: string;
  downloadsDir: string;
  persistent: true;
};

export async function getComputerBrowserStatus(): Promise<ComputerBrowserStatus> {
  const paths = ensureComputerDirs(getComputerPaths());
  const binary = findBrowserBinary();
  const running = await endpointReady(activePort, 400);
  return {
    available: !!binary,
    binary,
    running,
    port: activePort,
    profileDir: paths.browserProfile,
    downloadsDir: paths.downloads,
    persistent: true,
  };
}

/** Launch (or adopt) the computer's browser. Idempotent and lazy. */
export function ensureComputerBrowser(): Promise<ComputerBrowser> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const paths = ensureComputerDirs(getComputerPaths());
    if (browserProc && !browserProc.killed && browserProc.exitCode === null && (await endpointReady(activePort, 1000))) {
      return { endpoint: `http://127.0.0.1:${activePort}`, port: activePort, pid: browserProc.pid ?? 0, adopted: false };
    }
    const adopted = await adoptExisting(paths);
    if (adopted) {
      appendActivity({ kind: "browser", summary: "Adopted the running computer browser" }, paths);
      return adopted;
    }
    const binary = findBrowserBinary();
    if (!binary) {
      throw new Error("No Chrome/Chromium found. Install Chrome or set CHROME_PATH, then retry.");
    }
    mkdirSync(paths.browserProfile, { recursive: true });
    mkdirSync(paths.downloads, { recursive: true });
    const headless = process.env.QUBE_COMPUTER_BROWSER_HEADED !== "1";
    activePort = DEFAULT_BROWSER_PORT;
    const args = [
      `--remote-debugging-port=${activePort}`,
      `--user-data-dir=${paths.browserProfile}`,
      `--download-default-directory=${paths.downloads}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      ...(headless ? ["--headless=new", "--disable-gpu", "--window-size=1280,900"] : ["--start-maximized"]),
      "about:blank",
    ];
    const proc = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], detached: false, env: { ...process.env } });
    browserProc = proc;
    let stderrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-1500);
    });
    proc.on("exit", () => {
      if (browserProc === proc) {
        browserProc = null;
        ensurePromise = null;
      }
    });
    proc.on("error", () => {
      if (browserProc === proc) {
        browserProc = null;
        ensurePromise = null;
      }
    });
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (await endpointReady(activePort, 500)) {
        appendActivity({ kind: "browser", summary: "Started the computer browser" }, paths);
        return { endpoint: `http://127.0.0.1:${activePort}`, port: activePort, pid: proc.pid ?? 0, adopted: false };
      }
      if (proc.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      proc.kill();
    } catch {}
    browserProc = null;
    throw new Error(`Browser did not start.${stderrTail ? ` stderr: ${stderrTail.trim()}` : ""}`);
  })();
  ensurePromise.catch(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

/** Open a URL in the persistent profile (new tab). */
export async function openInComputerBrowser(url: string): Promise<{ url: string; endpoint: string }> {
  const browser = await ensureComputerBrowser();
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    await fetch(`http://127.0.0.1:${browser.port}/json/new?${encodeURIComponent(target)}`, { method: "PUT" });
  } catch (error) {
    throw new Error(`Browser is running but could not open a tab: ${(error as Error)?.message || error}`);
  }
  appendActivity({ kind: "browser", summary: `Opened ${target.slice(0, 180)}` });
  return { url: target, endpoint: browser.endpoint };
}

/** Stop a browser this process started. Adopted browsers are left alone. */
export async function stopComputerBrowser(): Promise<void> {
  if (!browserProc) return;
  const proc = browserProc;
  browserProc = null;
  ensurePromise = null;
  try {
    proc.kill("SIGTERM");
  } catch {}
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (proc.exitCode === null) {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
}

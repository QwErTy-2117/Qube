/**
 * Server-side package/distro detection for the updater hint.
 *
 * Runs only inside the Node sidecar. All commands are read-only queries with
 * fixed arguments — no user input reaches the shell.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { assessPackageState, type PackagePresence, type PackageState } from "./package-info";

const execFileAsync = promisify(execFile);
const APP_BINARY = "/usr/bin/qube";
const COMMAND_TIMEOUT_MS = 2_000;

let cachedBundleType: "deb" | "rpm" | "unknown" | null = null;

/**
 * Read the package type the running Tauri binary was built as. Tauri patches
 * a marker string into the binary for each bundle; the updater dispatches on
 * it, so it is the only reliable way to know whether `dpkg` or `rpm` will run.
 */
async function readBundleType(): Promise<"deb" | "rpm" | "unknown"> {
  if (cachedBundleType) return cachedBundleType;
  try {
    const buf = await readFile(APP_BINARY);
    const hasDeb = buf.includes("__TAURI_BUNDLE_TYPE_VAR_DEB");
    const hasRpm = buf.includes("__TAURI_BUNDLE_TYPE_VAR_RPM");
    cachedBundleType = hasDeb && !hasRpm ? "deb" : hasRpm && !hasDeb ? "rpm" : "unknown";
  } catch {
    cachedBundleType = "unknown";
  }
  return cachedBundleType;
}

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 128 * 1024,
    });
    return String(stdout || "").trim();
  } catch (e: unknown) {
    // dpkg/rpm write the useful result to stdout even on a non-zero exit
    // (e.g. "package qube is not installed", "no path found").
    const out = (e as { stdout?: unknown })?.stdout;
    return typeof out === "string" ? out.trim() : "";
  }
}

function parseDeb(raw: string): PackagePresence | null {
  if (!raw) return null;
  const [status = "", version = ""] = raw.split("|");
  const cleanStatus = status.trim();
  if (!/^install ok/i.test(cleanStatus)) return null;
  return {
    installed: true,
    status: cleanStatus,
    ...(version.trim() ? { version: version.trim() } : {}),
  };
}

function parseRpm(raw: string): PackagePresence | null {
  const value = raw.trim();
  if (!value || /not installed|is not installed/i.test(value)) return null;
  // `rpm -q --qf` prints "0.0.125-1" when installed.
  if (!/^\d/.test(value)) return null;
  return { installed: true, version: value };
}

/** Inspect the host distro and both package databases. Null when unsupported. */
export async function detectPackageState(): Promise<PackageState | null> {
  if (process.platform !== "linux") return null;
  const osRelease = await readFile("/etc/os-release", "utf8").catch(() => "");
  if (!osRelease.trim()) return null;

  const [debRaw, rpmRaw, dpkgOwner, rpmOwner, bundleType] = await Promise.all([
    run("dpkg-query", ["-W", "-f=${Status}|${Version}", "qube"]),
    run("rpm", ["-q", "--qf", "%{VERSION}-%{RELEASE}", "qube"]),
    run("dpkg", ["-S", APP_BINARY]),
    run("rpm", ["-qf", APP_BINARY]),
    readBundleType(),
  ]);

  const deb = parseDeb(debRaw);
  const rpm = parseRpm(rpmRaw);
  const dpkgOwnsBinary = /^qube\s*:/m.test(dpkgOwner) && dpkgOwner.includes(APP_BINARY);
  const rpmOwnsBinary = /^qube-/m.test(rpmOwner) && !/not owned/i.test(rpmOwner);

  return assessPackageState({
    platform: process.platform,
    arch: process.arch,
    osRelease,
    deb,
    rpm,
    dpkgOwnsBinary,
    rpmOwnsBinary,
    bundleType,
  });
}

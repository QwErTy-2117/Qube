/**
 * Qube Computer — persistent, isolated runtime paths.
 *
 * The computer is a single dedicated directory tree owned by Qube. Agent
 * tools run inside it by default (cwd locked to `home/`, HOME/XDG/TMPDIR
 * pointed inside, path resolution guarded). Nothing is ever wiped
 * implicitly: the filesystem, browser profile, cookies, logins, downloads
 * and attachments survive app restarts until the user explicitly resets
 * the computer.
 *
 * Layout:
 *   .computer/
 *     home/        the agent's working directory (its "disk")
 *     attachments/ files staged from the user into the computer
 *     downloads/   browser downloads
 *     browser/     Chromium user-data-dir (cookies, logins, session)
 *     logs/        activity journal (rolling, size-capped)
 *     tmp/         per-command scratch space (TMPDIR)
 *     state.json   session identity + reset counter
 */

import { resolve, join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export const COMPUTER_DIR_NAME = ".computer";

export type ComputerPaths = {
  /** Runtime root (never written to from outside this module). */
  root: string;
  /** The agent's working directory — its persistent "disk". */
  home: string;
  /** Staged user attachments, passed to tools by absolute path. */
  attachments: string;
  downloads: string;
  /** Chromium profile parent. */
  browser: string;
  browserProfile: string;
  logs: string;
  tmp: string;
  stateFile: string;
  activityFile: string;
};

export function getComputerPaths(): ComputerPaths {
  const root = resolve(getDataDir(), COMPUTER_DIR_NAME);
  const browser = join(root, "browser");
  return {
    root,
    home: join(root, "home"),
    attachments: join(root, "attachments"),
    downloads: join(root, "downloads"),
    browser,
    browserProfile: join(browser, "profile"),
    logs: join(root, "logs"),
    tmp: join(root, "tmp"),
    stateFile: join(root, "state.json"),
    activityFile: join(root, "logs", "activity.jsonl"),
  };
}

/** Directories that must exist before any tool runs. */
export function computerDirectories(paths: ComputerPaths = getComputerPaths()): string[] {
  return [paths.root, paths.home, paths.attachments, paths.downloads, paths.browser, paths.browserProfile, paths.logs, paths.tmp];
}

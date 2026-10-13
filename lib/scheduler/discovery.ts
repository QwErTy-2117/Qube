/**
 * Cheap deterministic discovery sweep (audit fix #9).
 *
 * Problem: quiet ticks skipped the LLM entirely when the checklist was
 * empty, so genuinely new work (a paper waiting to be compiled, fresh
 * workspace files, open durable goals) was never discovered. The monitor
 * could only re-find what was already listed.
 *
 * This sweep runs with NO model call: workspace root listing + recently
 * modified files (top 2 levels, bounded) + open durable-goal count. The
 * scheduler calls the LLM only on a hash diff, and records the hash so the
 * same diff never pages twice.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface DiscoveryResult {
  summary: string;
  hash: string;
  recentFiles: string[];
  rootEntries: number;
  openGoals: number;
}

async function listRoot(): Promise<{ entries: string[]; recent: string[] }> {
  const entries: string[] = [];
  const recent: string[] = [];
  try {
    const { getWorkspacePath } = await import("@/lib/middleware/workspace");
    const ws = getWorkspacePath();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const top = await readdir(ws, { withFileTypes: true }).catch(() => []);
    for (const e of top.slice(0, 100)) {
      entries.push(`${e.isDirectory() ? "d" : "f"}:${e.name}`);
      if (e.isDirectory() && !["node_modules", ".git", ".next"].includes(e.name)) {
        try {
          const sub = await readdir(join(ws, e.name), { withFileTypes: true }).catch(() => []);
          for (const s of sub.slice(0, 40)) {
            if (!s.isFile()) continue;
            try {
              const st = await stat(join(ws, e.name, s.name));
              if ((st.mtimeMs || 0) >= cutoff) recent.push(`${e.name}/${s.name}`);
            } catch {}
            if (recent.length >= 15) break;
          }
        } catch {}
      } else if (e.isFile()) {
        try {
          const st = await stat(join(ws, e.name));
          if ((st.mtimeMs || 0) >= cutoff) recent.push(e.name);
        } catch {}
      }
      if (recent.length >= 15) break;
    }
  } catch {}
  return { entries, recent };
}

export async function runDiscoverySweep(): Promise<DiscoveryResult> {
  const { entries, recent } = await listRoot();
  let openGoals = 0;
  try {
    const { listOpenGoals } = await import("@/lib/goals/store");
    openGoals = (await listOpenGoals(50).catch(() => [])).length;
  } catch {}
  const summary = `root=${entries.length} recent24h=[${recent.slice(0, 10).join(", ") || "none"}] openGoals=${openGoals}`;
  let hash = "";
  try {
    const { hashContent } = await import("@/lib/proactivity/store");
    hash = hashContent(`${entries.slice(0, 60).join("|")} :: ${recent.join("|")} :: goals=${openGoals}`);
  } catch {}
  return { summary, hash, recentFiles: recent, rootEntries: entries.length, openGoals };
}

/** True when this sweep found something worth waking the LLM for. */
export function isDiscoveryWorthy(
  sweep: DiscoveryResult,
  lastHash?: string | null,
): boolean {
  if (!sweep.hash || sweep.hash !== lastHash) {
    if (sweep.recentFiles.length > 0 || sweep.openGoals > 0) return true;
  }
  return false;
}

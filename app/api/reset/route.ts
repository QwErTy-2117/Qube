import { NextResponse } from "next/server";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { providerStore } from "@/lib/agent/provider-store";

export const runtime = "nodejs";

const DATA_FILES = [
  "providers.json",
  "chatgpt-sessions.json",
  "lwc-secret.txt",
  "app-settings.json",
  "computer-use.json",
  "scheduled-tasks.json",
  "semantic-memory.json",
  "session-tracker.json",
  "task-log.jsonl",
];

export async function POST() {
  try {
    // Clear in-memory provider store and remove the on-disk cache
    try {
      providerStore.sync([], null);
    } catch {}
    try {
      const providersFile = join(getDataDir(), ".memory", "providers.json");
      if (existsSync(providersFile)) unlinkSync(providersFile);
    } catch {}

    // Delete known data files (best-effort, ignore missing)
    for (const name of DATA_FILES) {
      try {
        const p = join(getDataDir(), ".memory", name);
        if (existsSync(p)) unlinkSync(p);
      } catch {}
    }

    // Delete sessions directory recursively
    try {
      const sessionsDir = join(getDataDir(), ".memory", "sessions");
      if (existsSync(sessionsDir)) {
        const { rmSync } = await import("node:fs");
        rmSync(sessionsDir, { recursive: true, force: true });
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

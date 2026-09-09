import { NextRequest, NextResponse } from "next/server";
import { prefetchQuery } from "@/lib/memory/voicemem-core";

export async function POST(req: NextRequest) {
  try {
    const { settingsStore } = await import("@/lib/settings-store");
    if (settingsStore.getAll().memoryEnabled === false) {
      return NextResponse.json({ ok: true, prefetched: false, reason: "memory disabled" });
    }
    const { partial, query } = await req.json();
    const text = (partial || query || "").trim();
    if (!text || text.length < 2) {
      return NextResponse.json({ ok: true, prefetched: false, reason: "too short" });
    }
    // Speculative prefetch like VoiceMem 0-300ms — fire and don't block
    const start = Date.now();
    await prefetchQuery(text);
    const elapsed = Date.now() - start;
    return NextResponse.json({ ok: true, prefetched: true, elapsedMs: elapsed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, usage: "POST { partial: string }" });
}

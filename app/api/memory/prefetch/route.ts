import { NextRequest, NextResponse } from "next/server";
import { warmup } from "@/lib/memory/memory-store";

export async function POST(req: NextRequest) {
  try {
    const { settingsStore } = await import("@/lib/settings-store");
    if (settingsStore.getAll().memoryEnabled === false) {
      return NextResponse.json({ ok: true, prefetched: false, reason: "memory disabled" });
    }
    const { partial, query } = await req.json().catch(() => ({}));
    const text = ((partial || query || "") as string).trim();
    if (!text || text.length < 2) {
      return NextResponse.json({ ok: true, prefetched: false, reason: "too short" });
    }
    // Retrieval is sub-ms in-memory; prefetch just warms the store.
    const start = Date.now();
    await warmup();
    return NextResponse.json({ ok: true, prefetched: true, elapsedMs: Date.now() - start });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, usage: "POST { partial: string }" });
}

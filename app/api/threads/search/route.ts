import { NextResponse } from "next/server";
import { listSessions, readSession } from "@/lib/memory/session-store";
import { readThreadSnapshot, snapshotText } from "@/lib/chat/thread-snapshots";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const sessions = await listSessions();
    if (!q) {
      return NextResponse.json({
        threads: sessions.slice(0, 20).map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      });
    }
    const scored: Array<{ id: string; title: string; createdAt: number; updatedAt: number; snippet: string }> = [];
    for (const s of sessions) {
      const titleMatch = s.title.toLowerCase().includes(q);
      let snippet = "";
      let match = titleMatch;
      if (!match) {
        // Transcript first, then the message snapshot (covers restorable chats).
        let haystack = "";
        try {
          const full = await readSession(s.id);
          haystack = ((full as any)?.transcript || "") as string;
        } catch {}
        if (!haystack) {
          try {
            const snap = await readThreadSnapshot(s.id);
            if (snap?.repository) haystack = snapshotText(snap.repository);
          } catch {}
        }
        const idx = haystack.toLowerCase().indexOf(q);
        if (idx >= 0) {
          match = true;
          const start = Math.max(0, idx - 40);
          snippet = haystack.slice(start, idx + q.length + 80).replace(/\s+/g, " ").trim();
        }
      }
      if (match) {
        scored.push({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, snippet });
      }
      if (scored.length >= 30) break;
    }
    return NextResponse.json({ threads: scored });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

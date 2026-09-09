import { NextResponse } from "next/server";
import { listSessions, saveSession } from "@/lib/memory/session-store";
import { listThreadSnapshotIds, readThreadSnapshot } from "@/lib/chat/thread-snapshots";

export async function GET() {
  try {
    const [sessions, snapIds] = await Promise.all([
      listSessions(),
      listThreadSnapshotIds(),
    ]);
    const threads = await Promise.all(
      sessions.map(async (s) => {
        let title = s.title;
        // Prefer snapshot title when session title is a placeholder.
        const t = (s.title ?? "").trim().toLowerCase();
        const placeholder =
          !t || t === "new chat" || t === "new thread" || t === "conversation" || t === "untitled";
        if (placeholder) {
          try {
            const snap = await readThreadSnapshot(s.id);
            if (snap?.title) title = snap.title;
          } catch {}
        }
        return {
          id: s.id,
          title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          hasMessages: snapIds.has(s.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128)),
        };
      }),
    );
    return NextResponse.json({ threads });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id =
      typeof body?.id === "string" && body.id.trim()
        ? body.id.trim().slice(0, 128)
        : `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const title =
      typeof body?.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : "New Chat";
    await saveSession(id, title, "", undefined, false);
    return NextResponse.json({ thread: { id, title } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

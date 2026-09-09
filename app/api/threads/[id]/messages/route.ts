import { NextResponse } from "next/server";
import { readSession, saveSession } from "@/lib/memory/session-store";
import {
  saveThreadSnapshot,
  readThreadSnapshot,
  isPlaceholderTitle,
} from "@/lib/chat/thread-snapshots";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const snap = await readThreadSnapshot(id);
    return NextResponse.json({ id, repository: snap?.repository ?? null, title: snap?.title ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const repository = body?.repository ?? null;
    const title = typeof body?.title === "string" ? body.title : undefined;

    // Never shrink a snapshot: racing partial viewports must not clobber a
    // fuller history (exports only ever grow in practice).
    try {
      const incomingCount = Array.isArray((repository as any)?.messages)
        ? (repository as any).messages.length
        : 0;
      const existing = await readThreadSnapshot(id);
      const existingCount = Array.isArray((existing?.repository as any)?.messages)
        ? (existing!.repository as any).messages.length
        : 0;
      if (existing && incomingCount < existingCount) {
        return NextResponse.json({
          ok: true,
          id,
          title: existing.title,
          titleSource: existing.titleSource ?? null,
          kept: true,
        });
      }
    } catch {}

    const snap = await saveThreadSnapshot(id, repository, title);

    // Keep the session row title in sync so list/search show the auto name.
    try {
      const existing = await readSession(id);
      if (existing) {
        if (isPlaceholderTitle(existing.title) || existing.title !== snap.title) {
          await saveSession(id, snap.title, existing.summary, (existing as any).transcript, existing.hasTranscript);
        }
      } else {
        await saveSession(id, snap.title, "", undefined, false);
      }
    } catch {}

    return NextResponse.json({ ok: true, id, title: snap.title, titleSource: snap.titleSource ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST mirrors PUT (navigator.sendBeacon only speaks POST; used for
// best-effort saves during page unload/navigation).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return PUT(req, ctx);
}

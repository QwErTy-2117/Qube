import { NextResponse } from "next/server";
import { readSession, deleteSession, renameSession, saveSession, setSessionStatus } from "@/lib/memory/session-store";
import { readThreadSnapshot, saveThreadSnapshot, deleteThreadSnapshot } from "@/lib/chat/thread-snapshots";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [session, snap] = await Promise.all([readSession(id), readThreadSnapshot(id)]);
    if (!session && !snap) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json({
      thread: {
        id,
        title: snap?.title || session?.title || "New Chat",
        createdAt: session?.createdAt || snap?.updatedAt || Date.now(),
        updatedAt: Math.max(session?.updatedAt || 0, snap?.updatedAt || 0),
        status: session?.status || "regular",
      },
      repository: snap?.repository ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    if (typeof body?.status === "string" && (body.status === "archived" || body.status === "regular")) {
      const updated = await setSessionStatus(id, body.status);
      if (!updated) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
      }
      return NextResponse.json({ thread: { id, status: updated.status } });
    }

    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    let renamed = await renameSession(id, title);
    if (!renamed) {
      // Explicit user rename of a not-yet-saved thread: create the row
      // (user intent, not an auto-saved empty).
      await saveSession(id, title, "", undefined, false);
      renamed = await readSession(id).then((s) => {
        if (!s) return null;
        const { transcript: _, ...record } = s as typeof s & { transcript?: string };
        return record;
      });
    }
    const snap = await readThreadSnapshot(id);
    if (snap) {
      // Explicit user rename: manual titles are never auto-overwritten.
      await saveThreadSnapshot(id, snap.repository, title, "manual");
    }
    if (!renamed && !snap) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    return NextResponse.json({ thread: { id, title } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await Promise.all([deleteSession(id), deleteThreadSnapshot(id)]);
    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

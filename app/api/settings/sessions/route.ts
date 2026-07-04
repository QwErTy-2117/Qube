import { NextResponse } from "next/server";
import { listSessions, deleteSession } from "@/lib/memory/session-store";

export async function GET() {
  try {
    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      await deleteSession(id);
    } else {
      const sessions = await listSessions();
      for (const session of sessions) {
        await deleteSession(session.id);
      }
    }

    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

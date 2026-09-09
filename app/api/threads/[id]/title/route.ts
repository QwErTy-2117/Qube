import { NextResponse } from "next/server";
import { ensureThreadTitle } from "@/lib/pi/chat-title-agent";

/**
 * Agent-generated title for a chat (background LLM call, not a tool call).
 * Awaits generation and returns the title; falls back gracefully.
 * Manual renames always win.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const userText = typeof body?.userText === "string" ? body.userText : undefined;
    const assistantText = typeof body?.assistantText === "string" ? body.assistantText : undefined;
    const title = await ensureThreadTitle(id, userText, assistantText);
    return NextResponse.json({ id, title });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

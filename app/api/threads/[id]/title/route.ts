import { NextResponse } from "next/server";
import { requestChatTitle } from "@/lib/pi/chat-title-agent";

/**
 * Queue an agent-generated title for a chat (background LLM call, not a tool
 * call). Returns immediately; the title lands shortly after via the normal
 * thread endpoints. Manual renames always win.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    requestChatTitle(id);
    return NextResponse.json({ queued: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

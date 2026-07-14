import { NextRequest, NextResponse } from "next/server";
import { resolveConfirmation } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { confirmationId, action } = await req.json();
    if (!confirmationId || !action) {
      return NextResponse.json({ error: "Missing confirmationId or action" }, { status: 400 });
    }
    if (action !== "confirm" && action !== "cancel") {
      return NextResponse.json({ error: "Action must be 'confirm' or 'cancel'" }, { status: 400 });
    }
    const ok = resolveConfirmation(confirmationId, action);
    if (!ok) {
      return NextResponse.json({ error: "Confirmation not found or expired" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[connectors/confirm] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

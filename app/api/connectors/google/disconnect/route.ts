import { NextResponse } from "next/server";
import { disconnect } from "@/lib/connectors/google";

export async function POST() {
  try {
    await disconnect();
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

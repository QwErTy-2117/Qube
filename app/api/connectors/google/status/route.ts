import { NextResponse } from "next/server";
import { isConnected } from "@/lib/connectors/google";

export async function GET() {
  return NextResponse.json({ connected: isConnected() });
}

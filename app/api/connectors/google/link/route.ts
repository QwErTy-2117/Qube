import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, getCallbackPath } from "@/lib/connectors/google";

export async function POST(req: NextRequest) {
  try {
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "127.0.0.1:3010";
    const callbackUrl = `${protocol}://${host}${getCallbackPath()}`;
    const url = getAuthUrl(callbackUrl);
    return NextResponse.json({ url, callbackUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

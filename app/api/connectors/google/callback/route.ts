import { NextRequest, NextResponse } from "next/server";
import { handleCallback, getCallbackPath } from "@/lib/connectors/google";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");
    if (!code) {
      return new Response("Missing code parameter", { status: 400 });
    }
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "127.0.0.1:3010";
    const callbackUrl = `${protocol}://${host}${getCallbackPath()}`;
    await handleCallback(code, callbackUrl);
    return new Response(
      `<html><body><script>window.close()</script><p>Connected! Close this window.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (e: any) {
    return new Response(`Auth failed: ${e.message}`, { status: 500 });
  }
}

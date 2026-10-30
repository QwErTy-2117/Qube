import { cuaFrameStore } from "@/lib/cua/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Latest real CUA Driver screenshot for the Computer panel. Frames are
 * versioned; the URL includes the version so the browser can cache them
 * immutably without ever showing an older action on a newer frame.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = (url.searchParams.get("threadId") || "").trim();
  const versionRaw = Number(url.searchParams.get("v") || "0");
  const frame = cuaFrameStore.get(threadId || undefined);
  if (!frame) {
    return new Response("No computer-use frame available.", { status: 404 });
  }
  if (Number.isFinite(versionRaw) && versionRaw > 0 && frame.version !== versionRaw) {
    return new Response("Frame version no longer available.", { status: 404 });
  }
  const etag = `"cua-${frame.threadId}-${frame.version}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const bytes = Uint8Array.from(Buffer.from(frame.base64, "base64"));
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": frame.mime || "image/png",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}

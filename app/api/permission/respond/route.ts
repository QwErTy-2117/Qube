import { NextRequest } from "next/server";
import { resolvePermission } from "@/lib/middleware/permission-middleware";

export async function POST(req: NextRequest) {
  try {
    const { requestId, approved } = await req.json();
    if (!requestId || typeof approved !== "boolean") {
      return Response.json(
        { error: "requestId and approved are required" },
        { status: 400 },
      );
    }
    const resolved = resolvePermission(requestId, approved);
    if (!resolved) {
      return Response.json(
        { error: "Permission request not found or already resolved" },
        { status: 404 },
      );
    }
    return Response.json({ success: true, approved });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}

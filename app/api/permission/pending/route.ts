import { NextRequest } from "next/server";
import { getPendingPermissions } from "@/lib/middleware/permission-middleware";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId") || undefined;
  const pending = getPendingPermissions(threadId);
  return Response.json({ pending });
}

import { NextRequest } from "next/server";
import {
  resolvePermission,
  getPermissionRequest,
} from "@/lib/middleware/permission-middleware";
import { getWorkspacePath } from "@/lib/middleware/workspace";
import { allowedDirsStore, scopeDirForPath } from "@/lib/permissions/allowed-dirs";

export async function POST(req: NextRequest) {
  try {
    const { requestId, approved, always } = await req.json();
    if (!requestId || typeof approved !== "boolean") {
      return Response.json(
        { error: "requestId and approved are required" },
        { status: 400 },
      );
    }

    // "Allow always": persist the containing directory to Allowed directories
    // (always read+write) so future accesses skip the prompt.
    let allowedDir: { path: string; access: string } | null = null;
    if (approved && always === true) {
      try {
        const pending = getPermissionRequest(requestId);
        const pathArg =
          (pending?.args?.path as string) ||
          (pending?.args?.filepath as string) ||
          (pending?.args?.cwd as string) ||
          "";
        if (pathArg && pending) {
          const scope = scopeDirForPath(pathArg, getWorkspacePath());
          if (scope) {
            const entry = allowedDirsStore.add(scope, "write", "chat");
            allowedDir = { path: entry.path, access: entry.access };
          }
        }
      } catch (e) {
        console.warn("[permission] allow-always persist failed:", e);
      }
    }

    const resolved = resolvePermission(requestId, approved);
    if (!resolved) {
      return Response.json(
        { error: "Permission request not found or already resolved" },
        { status: 404 },
      );
    }
    return Response.json({ success: true, approved, allowedDir });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}

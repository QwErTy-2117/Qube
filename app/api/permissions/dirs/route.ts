import { NextRequest } from "next/server";
import { statSync } from "node:fs";
import { allowedDirsStore, toAbsoluteDir, type DirAccess } from "@/lib/permissions/allowed-dirs";

/** Reject paths that exist but aren't folders (pickers can slip files through). */
function assertDirectory(raw: string): string | null {
  const abs = toAbsoluteDir(raw);
  if (!abs) return "Invalid path.";
  try {
    if (!statSync(abs).isDirectory()) return `"${raw}" is a file, not a folder.`;
  } catch {
    // Doesn't exist (yet) — allow it; enforcement checks at access time.
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const check = url.searchParams.get("check");
    if (typeof check === "string" && check.trim()) {
      // Verify a picked path is actually a folder (pickers can slip files through).
      const { toAbsoluteDir } = await import("@/lib/permissions/allowed-dirs");
      const abs = toAbsoluteDir(check.trim());
      if (!abs) return Response.json({ ok: false, isDirectory: false, error: "Invalid path." });
      try {
        const st = statSync(abs);
        if (!st.isDirectory()) {
          return Response.json({ ok: false, isDirectory: false, error: "That is a file, not a folder." });
        }
        return Response.json({ ok: true, isDirectory: true, path: abs });
      } catch {
        // Doesn't exist — let the caller decide (typed paths may be new).
        return Response.json({ ok: true, isDirectory: null, path: abs });
      }
    }
    return Response.json({ dirs: allowedDirsStore.getAll() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Bulk replace from Preferences UI
    if (Array.isArray(body.dirs)) {
      for (const d of body.dirs) {
        if (d && typeof d.path === "string") {
          const err = assertDirectory(d.path);
          if (err) return Response.json({ ok: false, error: err }, { status: 400 });
        }
      }
      const res = allowedDirsStore.sync(body.dirs);
      if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });
      return Response.json({ ok: true, dirs: allowedDirsStore.getAll() });
    }
    // Single upsert
    if (body.dir && typeof body.dir.path === "string") {
      const err = assertDirectory(body.dir.path);
      if (err) return Response.json({ ok: false, error: err }, { status: 400 });
      const abs = toAbsoluteDir(body.dir.path);
      if (!abs) return Response.json({ ok: false, error: "Invalid path." }, { status: 400 });
      const access: DirAccess = body.dir.access === "write" ? "write" : "read";
      const entry = allowedDirsStore.add(abs, access, "settings");
      return Response.json({ ok: true, dir: entry, dirs: allowedDirsStore.getAll() });
    }
    // Access change
    if (body.action === "access" && typeof body.id === "string") {
      const access: DirAccess = body.access === "write" ? "write" : "read";
      const entry = allowedDirsStore.setAccess(body.id, access);
      if (!entry) return Response.json({ ok: false, error: "Directory not found." }, { status: 404 });
      return Response.json({ ok: true, dir: entry, dirs: allowedDirsStore.getAll() });
    }
    // Delete
    if (body.action === "delete" && typeof body.id === "string") {
      const ok = allowedDirsStore.remove(body.id);
      if (!ok) return Response.json({ ok: false, error: "Directory not found." }, { status: 404 });
      return Response.json({ ok: true, dirs: allowedDirsStore.getAll() });
    }
    return Response.json(
      { ok: false, error: "Provide {dirs[]} or {dir} or {action:'access'|'delete',id}" },
      { status: 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

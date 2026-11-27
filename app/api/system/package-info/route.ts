import { detectPackageState } from "@/lib/system/package-info-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/package-info — distro family + installed package type.
 *
 * Read-only: reads /etc/os-release and queries dpkg/rpm. Used by the updater
 * to explain a package-type mismatch (e.g. a .deb installed on Fedora) with
 * the exact one-time install command. Never exposes user data.
 */
export async function GET() {
  try {
    const state = await detectPackageState();
    if (!state) {
      return Response.json({ ok: true, supported: false, platform: process.platform });
    }
    return Response.json({ ok: true, supported: true, ...state });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, supported: false, error: message.slice(0, 300) }, { status: 500 });
  }
}

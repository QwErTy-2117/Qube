import { getBrowserStatus } from "@/lib/browser/managed-chrome";
import { getFramesStats } from "@/lib/browser/screencast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Point-in-time browser health for the side panel diagnostics. */
export async function GET() {
  try {
    const [browser, frames] = await Promise.all([
      getBrowserStatus(),
      Promise.resolve(getFramesStats()),
    ]);
    return Response.json({ ok: true, browser, frames });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

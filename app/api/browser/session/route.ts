import { browserStore } from "@/lib/agent/browser/browser-store";
import { validateBrowserUrl } from "@/lib/agent/browser/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ ok: true, session: browserStore.publicSnapshot() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, url } = body as { action?: string; url?: string };
    if (!action) return Response.json({ ok: false, error: "action required" }, { status: 400 });
    if (action === "set") {
      if (!url) return Response.json({ ok: false, error: "url required" }, { status: 400 });
      const v = validateBrowserUrl(url);
      if (!v.ok) return Response.json({ ok: false, error: v.error }, { status: 400 });
      browserStore.setUrl(v.url);
      return Response.json({ ok: true, session: browserStore.publicSnapshot() });
    }
    if (action === "close" || action === "reset") {
      browserStore.reset();
      return Response.json({ ok: true, session: browserStore.publicSnapshot() });
    }
    return Response.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[browser/session] failed:", msg.slice(0, 500));
    return Response.json({ ok: false, error: "Browser action failed" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    browserStore.reset();
    return Response.json({ ok: true, session: browserStore.publicSnapshot() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

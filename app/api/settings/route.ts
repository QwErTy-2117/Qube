import { settingsStore, type AppSettings } from "@/lib/settings-store";

export async function GET() {
  try {
    const settings = settingsStore.getAll();
    return Response.json({ settings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { settings } = body as { settings: AppSettings };

    if (!settings || typeof settings !== "object") {
      return Response.json({ ok: false, error: "settings must be an object" }, { status: 400 });
    }

    settingsStore.update(settings);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { providerStore } from "@/lib/agent/provider-store";
import type { ProviderConfig } from "@/components/shared/settings-dialog";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { providers, defaultModelId } = body as {
      providers: ProviderConfig[];
      defaultModelId?: string | null;
    };

    if (!Array.isArray(providers)) {
      return Response.json({ ok: false, error: "providers must be an array" }, { status: 400 });
    }

    providerStore.sync(providers, defaultModelId);

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const providers = providerStore.getAllProviders();
    const defaultModelId = providerStore.getDefaultModelId();
    return Response.json({ providers, defaultModelId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { hasBuiltInKey, resetComposioClient } from "@/lib/connectors/composio";
import { composioKeyStore, maskApiKey, type ComposioKeyMode } from "@/lib/connectors/composio-key-store";

export const dynamic = "force-dynamic";

function statusPayload() {
  const state = composioKeyStore.getState();
  return {
    mode: state.mode,
    hasCustomKey: !!state.customKey,
    customKeyMasked: maskApiKey(state.customKey),
    hasBuiltInKey: hasBuiltInKey(),
  };
}

export async function GET() {
  try {
    return NextResponse.json(statusPayload());
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const mode = body?.mode as ComposioKeyMode | undefined;
    const customKey = body?.customKey as unknown;

    if (mode !== "builtin" && mode !== "custom") {
      return NextResponse.json({ ok: false, error: "mode must be 'builtin' or 'custom'" }, { status: 400 });
    }

    if (mode === "custom") {
      if (typeof customKey === "string" && customKey.trim().length > 0) {
        if (customKey.trim().length < 8) {
          return NextResponse.json(
            { ok: false, error: "Provide a valid custom Composio API key (at least 8 characters)." },
            { status: 400 }
          );
        }
        composioKeyStore.setCustomKey(customKey.trim());
      } else {
        // No new key typed — keep the saved one, just switch back to it.
        if (!composioKeyStore.getCustomKey()) {
          return NextResponse.json(
            { ok: false, error: "No custom key saved yet — paste your Composio API key first." },
            { status: 400 }
          );
        }
        composioKeyStore.setMode("custom");
      }
    } else {
      // Back to built-in. Keep any saved custom key so switching back is easy.
      composioKeyStore.setMode("builtin");
    }

    // Drop the cached client so the next call uses the newly selected key.
    resetComposioClient();
    return NextResponse.json({ ok: true, ...statusPayload() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    composioKeyStore.clearCustomKey();
    resetComposioClient();
    return NextResponse.json({ ok: true, ...statusPayload() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

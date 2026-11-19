import { NextResponse } from "next/server";
import {
  performHardReset,
  shouldExitAfterHardReset,
} from "@/lib/system/hard-reset";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await performHardReset();
    const response = NextResponse.json({
      ok: result.ok,
      removed: result.removed.length,
      errors: result.errors,
      warnings: result.warnings,
    }, { status: result.ok ? 200 : 500 });

    // Let the response flush first: the desktop shell needs it to know the
    // reset succeeded before it clears the webview and restarts the sidecar.
    if (result.ok && shouldExitAfterHardReset()) {
      setTimeout(() => process.exit(0), 1000);
    }

    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

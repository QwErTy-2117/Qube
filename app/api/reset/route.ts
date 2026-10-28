import { NextResponse } from "next/server";
import { performHardReset } from "@/lib/system/hard-reset";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await performHardReset();
    return NextResponse.json({
      ok: result.ok,
      removed: result.removed.length,
      errors: result.errors,
      warnings: result.warnings,
    }, { status: result.ok ? 200 : 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

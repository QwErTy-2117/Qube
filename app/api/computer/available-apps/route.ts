import { computerManager } from "@/lib/agent/computer/computer-manager";

export async function GET() {
  try {
    const windows = await computerManager.listWindows();
    return Response.json({ windows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

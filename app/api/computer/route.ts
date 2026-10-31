/**
 * Qube Computer panel API.
 *
 * GET  → live session status: session id, paths, disk usage, browser state
 *        and the recent activity journal (what the agent actually did).
 * POST → the two actions the panel owns: `reset` (explicit, confirmed by
 *        the UI) and `browser-stop`. Agent work itself goes through tools.
 */

import { NextResponse } from "next/server";
import { getComputerStatus, readActivity, resetComputer } from "@/lib/computer/session";
import { getComputerBrowserStatus, stopComputerBrowser } from "@/lib/computer/browser";
import { listComputerDir } from "@/lib/computer/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getComputerStatus();
    const browser = await getComputerBrowserStatus();
    const files = await listComputerDir(".", { depth: 1, limit: 60 }).catch(() => []);
    return NextResponse.json({
      ok: true,
      session: status.session,
      paths: { home: status.paths.home, attachments: status.paths.attachments, downloads: status.paths.downloads },
      usage: status.usage,
      attachments: status.attachments,
      downloads: status.downloads,
      files,
      browser: { available: browser.available, running: browser.running, persistent: browser.persistent },
      activity: readActivity(60),
      persistent: status.persistent,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error)?.message || String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { action?: string; keepAttachments?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action;
  try {
    if (action === "reset") {
      const result = await resetComputer({ keepAttachments: body.keepAttachments !== false });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "browser-stop") {
      await stopComputerBrowser();
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: `Unknown action: ${action ?? "(none)"}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error)?.message || String(error) }, { status: 500 });
  }
}

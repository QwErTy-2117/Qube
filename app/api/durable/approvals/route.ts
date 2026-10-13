import { NextRequest } from "next/server";
import { denyApproval, grantApproval, keyFor, readApprovals } from "@/lib/pi/durable-approvals";

/**
 * Durable approval ledger API.
 * GET  → { allowed, denied } (keys with timestamps).
 * POST → { tool, args?, key?, decision } where decision is allow|deny.
 *        Computes the guard key and records the decision durably so the
 *        durable guard hook allows (or blocks) that exact call.
 */
export async function GET() {
  try {
    const approvals = await readApprovals();
    return Response.json({
      allowed: Object.keys(approvals.allowed),
      denied: Object.keys(approvals.denied),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      tool?: string;
      args?: unknown;
      key?: string;
      decision?: string;
    };
    const decision = body.decision === "deny" ? "deny" : body.decision === "allow" ? "allow" : null;
    if (!decision) {
      return Response.json({ error: "decision must be 'allow' or 'deny'" }, { status: 400 });
    }
    const key = body.key || (body.tool ? keyFor(body.tool, body.args ?? {}) : "");
    if (!key) {
      return Response.json({ error: "tool+args or key is required" }, { status: 400 });
    }
    if (decision === "allow") await grantApproval(key);
    else await denyApproval(key);
    return Response.json({ success: true, key, decision });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

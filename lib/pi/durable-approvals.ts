import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getDurableHarness } from "@/lib/pi/durable";
import { argsHash } from "@/lib/pi/durable-guard";
import { approvalMemoKey } from "@/lib/pi/durable-registry";
import { Approvals } from "@/lib/pi/durable-docs";

export { Approvals };

export function keyFor(tool: string, args: unknown): string {
  return approvalMemoKey(tool, argsHash(args));
}

export async function readApprovals(context = BACKGROUND_CONTEXT): Promise<{ allowed: Record<string, number>; denied: Record<string, number> }> {
  const h = await getDurableHarness(context);
  const snap = await h.snapshot(Approvals, context);
  return { allowed: { ...(snap?.allowed ?? {}) }, denied: { ...(snap?.denied ?? {}) } };
}

async function mutate(
  key: string,
  kind: "allowed" | "denied",
  context: typeof BACKGROUND_CONTEXT,
): Promise<void> {
  const h = await getDurableHarness(context);
  const root = await h.root(context);
  await root.commit(async (tx) => {
    const doc = await tx.doc(Approvals);
    delete doc.allowed[key];
    delete doc.denied[key];
    doc[kind][key] = Date.now();
  }, context);
}

/** Grant durable approval for this exact tool call (key from `keyFor`). */
export async function grantApproval(key: string, context = BACKGROUND_CONTEXT): Promise<void> {
  await mutate(key, "allowed", context);
}

/** Record a durable denial for this exact tool call. */
export async function denyApproval(key: string, context = BACKGROUND_CONTEXT): Promise<void> {
  await mutate(key, "denied", context);
}

/** Resolve a pending key if the conversation is waiting on this call. */
export function approvalKeyForTool(tool: string, args: unknown): string {
  return keyFor(tool, args);
}

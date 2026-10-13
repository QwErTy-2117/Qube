import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getDurableHarness } from "@/lib/pi/durable";

export async function getOrCreateConversation(threadId: string, context = BACKGROUND_CONTEXT) {
  const h = await getDurableHarness(context);
  if (threadId === "root") return h.root(context);
  return h.createConversation({ ownership: { kind: "ownerless" } }, context);
}

export async function listDurableThreads(context = BACKGROUND_CONTEXT) {
  const h = await getDurableHarness(context);
  return h.taskGraph(context).then(() => [] as Array<{ id: string; title: string }>);
}

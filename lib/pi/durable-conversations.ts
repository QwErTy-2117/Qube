import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc } from "@earendil-works/pi-durable";
import { getDurableHarness } from "@/lib/pi/durable";

export const ThreadMap = defineDoc<{ ids: Record<string, string>; titles: Record<string, string> }>({
  kind: "app.thread-map",
  version: 1,
  scope: "session",
  initial: () => ({ ids: {}, titles: {} }),
});

export async function getOrCreateConversation(threadId: string, context = BACKGROUND_CONTEXT) {
  const h = await getDurableHarness(context);
  if (threadId === "root") return h.root(context);
  const mapped = await h.snapshot(ThreadMap, context);
  const existingId = mapped?.ids[threadId];
  if (existingId) {
    const handle = await h.conversation(existingId, context);
    if (handle) return handle;
  }
  const root = await h.root(context);
  const created = await root.commit(async (tx) => {
    const rec = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const doc = await tx.doc(ThreadMap);
    doc.ids[threadId] = rec.id;
    if (!doc.titles[threadId]) doc.titles[threadId] = "New Chat";
    return rec;
  }, context);
  const handle = await h.conversation(created.id, context);
  if (!handle) throw new Error(`Failed to open conversation for thread "${threadId}"`);
  return handle;
}

export async function listDurableThreads(context = BACKGROUND_CONTEXT) {
  const h = await getDurableHarness(context);
  const root = await h.root(context);
  const page = await root.commit((tx) => tx.scanConversations({ order: "descending" }, 200), context);
  const mapped = await h.snapshot(ThreadMap, context);
  const reverse = new Map<string, string>();
  for (const [qubeId, convId] of Object.entries(mapped?.ids ?? {})) reverse.set(convId, qubeId);
  return page.items
    .filter((c) => reverse.has(c.id))
    .map((c) => {
      const qubeId = reverse.get(c.id)!;
      return { id: qubeId, title: mapped?.titles[qubeId] ?? "New Chat" };
    });
}

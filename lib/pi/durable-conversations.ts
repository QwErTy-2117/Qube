import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, type ConversationId } from "@earendil-works/pi-durable";
import { getDurableHarness } from "@/lib/pi/durable";
import { resolveModelRef, resolveThinkingLevel } from "@/lib/pi/durable-models";

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
    // Runtime conversation IDs are UUIDv7 strings (proven by round-trip
    // tests); the .d.ts brands them as numbers, hence the cast.
    const handle = await h.conversation(existingId as unknown as ConversationId, context);
    if (handle) return handle;
  }
  const root = await h.root(context);
  const created = await root.commit(async (tx) => {
    const rec = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const doc = await tx.doc(ThreadMap);
    doc.ids[threadId] = String(rec.id);
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
    .filter((c) => reverse.has(String(c.id)))
    .map((c) => {
      const qubeId = reverse.get(String(c.id))!;
      return { id: qubeId, title: mapped?.titles[qubeId] ?? "New Chat" };
    });
}

export type DurableAgentSync = {
  modelName?: string | null;
  reasoningEffort?: string;
  cwd?: string | null;
};

/**
 * Align a conversation's stored agent with Qube's current defaults.
 * Configures model/thinkingLevel/cwd only when they differ, so steady
 * state costs zero commits. Unknown model ids leave the stored agent
 * untouched (generation then fails with a clear provider error).
 */
export async function syncConversationAgent(
  threadId: string,
  sync: DurableAgentSync,
  context = BACKGROUND_CONTEXT,
) {
  const conv = await getOrCreateConversation(threadId, context);
  const change: Record<string, unknown> = {};
  if (sync.modelName) {
    const ref = resolveModelRef(sync.modelName);
    if (ref) {
      const current = await conv.agent(context);
      if (current.model?.provider !== ref.provider || current.model?.modelId !== ref.modelId) {
        change.model = ref;
      }
    }
  }
  if (sync.reasoningEffort !== undefined) {
    const level = resolveThinkingLevel(sync.reasoningEffort);
    const current = await conv.agent(context);
    if (current.thinkingLevel !== level) change.thinkingLevel = level;
  }
  if (sync.cwd !== undefined && sync.cwd !== null) {
    const current = await conv.agent(context);
    if (current.cwd !== sync.cwd) change.cwd = sync.cwd;
  }
  if (Object.keys(change).length > 0) {
    await conv.configure(change as never, context);
  }
  return conv;
}

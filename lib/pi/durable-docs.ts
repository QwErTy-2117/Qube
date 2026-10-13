import { defineDoc, type ConversationId, type Tx } from "@earendil-works/pi-durable";

export const Todos = defineDoc<{ items: string[] }>({
  kind: "app.todos",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ items: [] }),
});

export const Scratchpad = defineDoc<{ text: string }>({
  kind: "app.scratchpad",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

/**
 * Session-scoped approval ledger for the durable guard. The guard hook
 * can only read (HookApi is a DocumentReader); the app/UI writes here
 * when a person allows or denies a sensitive call. Keys are
 * `approval:<tool>:<argsHash>`.
 */
export const Approvals = defineDoc<{ allowed: Record<string, number>; denied: Record<string, number> }>({
  kind: "app.approvals",
  version: 1,
  scope: "session",
  initial: () => ({ allowed: {}, denied: {} }),
});

export async function seedDurableDocs(tx: Tx, conversationId: ConversationId) {
  await tx.doc(Todos, conversationId);
}

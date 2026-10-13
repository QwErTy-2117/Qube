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

export async function seedDurableDocs(tx: Tx, conversationId: ConversationId) {
  await tx.doc(Todos, conversationId);
}

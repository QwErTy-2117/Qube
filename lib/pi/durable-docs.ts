import { defineDoc } from "@earendil-works/pi-durable";

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
  history: "latest",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

export async function seedDurableDocs(tx: { doc: (d: typeof Todos, id: string) => Promise<{ items: string[] }> }, _conversationId: string) {
  await tx.doc(Todos, _conversationId);
}

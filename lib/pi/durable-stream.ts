import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AssistantEntry } from "@earendil-works/pi-durable";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";

export function buildRequestId(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

export async function submitDurableChat(threadId: string, text: string, requestId: string, context = BACKGROUND_CONTEXT) {
  const conv = await getOrCreateConversation(threadId, context);
  const submission = await conv.submit({ type: "input", content: text, requestId } as never, context);
  const settled = await submission.wait(context);
  if (settled.status === "done" && settled.type === "input") {
    const entry = await conv.commit((tx) => tx.entry(AssistantEntry, settled.answer!), context);
    return entry?.model?.[0] ?? null;
  }
  return null;
}

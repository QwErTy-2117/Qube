import { createAgent } from "@/lib/agent/agent";
import { extractAndStoreMemories } from "@/lib/agent/memory-agent";
import { saveSession } from "@/lib/memory/session-store";
import {
  getLastThreadId,
  setLastThreadId,
} from "@/lib/memory/session-tracker";
import { convertToModelMessages } from "ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages, threadId } = await req.json();
    const currentThreadId = threadId || `thread_${Date.now()}`;

    const lastThreadId = await getLastThreadId();
    if (lastThreadId && lastThreadId !== currentThreadId) {
      const { readSession } = await import("@/lib/memory/session-store");
      const prevSession = await readSession(lastThreadId);
      if (prevSession?.transcript) {
        extractAndStoreMemories(prevSession.transcript).catch(() => {});
      }
    }

    const transcript = (messages || [])
      .map(
        (m: any) =>
          `${m.role}: ${typeof m.content === "string" ? m.content : ""}`,
      )
      .join("\n");

    const firstMsg =
      messages?.find((m: any) => m.role === "user")?.content || "";
    const title =
      typeof firstMsg === "string"
        ? firstMsg.slice(0, 80)
        : "Conversation";

    saveSession(
      currentThreadId,
      title,
      "",
      transcript,
      true,
    ).catch(() => {});

    await setLastThreadId(currentThreadId);

    const modelMessages = await convertToModelMessages(messages);
    const result = await createAgent({
      messages: modelMessages,
      threadId: currentThreadId,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    const {
      createUIMessageStream,
      createUIMessageStreamResponse,
    } = await import("ai");
    const stream = createUIMessageStream({
      originalMessages: [],
      execute: async ({ writer }) => {
        await writer.write({ type: "text-start", id: "error-text" });
        await writer.write({
          type: "text-delta",
          id: "error-text",
          delta: `An error occurred: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}

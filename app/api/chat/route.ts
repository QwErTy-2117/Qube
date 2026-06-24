import { createAgent } from "@/lib/agent/agent";
import { convertToModelMessages } from "ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages, threadId } = await req.json();
    const modelMessages = await convertToModelMessages(messages);

    const result = await createAgent({
      messages: modelMessages,
      threadId: threadId || undefined,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    const { createUIMessageStream, createUIMessageStreamResponse } = await import("ai");
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

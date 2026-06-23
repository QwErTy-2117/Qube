import { mistral } from "@ai-sdk/mistral";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  if (!process.env.MISTRAL_API_KEY) {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        await writer.write({
          type: "text-delta",
          id: "fallback-text",
          delta:
            "This starter is running without MISTRAL_API_KEY. Add one to .env.local to enable live AI responses.",
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  const result = streamText({
    model: mistral("mistral-large-latest"),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}

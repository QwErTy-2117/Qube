import { createAgent } from "@/lib/agent/agent";
import { extractAndStoreMemories } from "@/lib/agent/memory-agent";
import { saveSession } from "@/lib/memory/session-store";
import {
  getLastThreadId,
  setLastThreadId,
} from "@/lib/memory/session-tracker";
import { convertToModelMessages } from "ai";

export const maxDuration = 60;

function extractText(m: Record<string, unknown>): string {
  const parts = (m.parts as Array<Record<string, unknown>>) || [];
  if (parts.length > 0) {
    return parts
      .map((p: Record<string, unknown>) => {
        if (typeof p.text === "string") return p.text;
        if (p.type === "tool-call") return `[tool call: ${p.toolName}]`;
        if (p.type === "tool-result") return `[tool result: ${p.toolName}]`;
        if (typeof p.content === "string") return p.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p: Record<string, unknown>) => {
        if (typeof p.text === "string") return p.text;
        if (p.type === "tool-call") return `[tool call: ${p.toolName}]`;
        if (p.type === "tool-result") return `[tool result: ${p.toolName}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

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
      .map((m: any) => `${m.role}: ${extractText(m)}`)
      .join("\n");

    const firstMsg = messages?.find((m: any) => m.role === "user") || {};
    const firstParts = (firstMsg.parts || firstMsg.content || []) as any[];
    const title =
      Array.isArray(firstParts)
        ? firstParts.map((p: any) => p.text || "").filter(Boolean).join(" ").slice(0, 80) || "Conversation"
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

    return result.toUIMessageStreamResponse({ sendSources: true });
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

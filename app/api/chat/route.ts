import { createAgent } from "@/lib/agent/agent";
import { extractAndStoreMemories, cleanupMemories } from "@/lib/agent/memory-agent";
import { cerebras, toCerebrasModelId } from "@/lib/agent/cerebras";
import { saveSession } from "@/lib/memory/session-store";
import {
  getLastThreadId,
  setLastThreadId,
} from "@/lib/memory/session-tracker";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
} from "ai";

export const maxDuration = 120;

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

function extractUserRequest(messages: any[]): string {
  for (const m of messages) {
    if (m.role === "user") {
      const text = extractText(m);
      if (text) return text.slice(0, 500);
    }
  }
  return "Complete the user's request.";
}

async function verifyCompletion(
  request: string,
  prevMessages: any[],
  agentText: string,
): Promise<{ done: boolean; message: string }> {
  if (!agentText) return { done: false, message: "No response from agent" };

  const contextLines = prevMessages.slice(-4).map((m: any) => {
    const role = m.role || "?";
    const t = typeof m.content === "string" ? m.content.slice(0, 150) : "";
    return `[${role}]: ${t}`;
  });

  const system = `You are a task completion verifier. Determine if the user's request has been fully satisfied.

Request: "${request}"
Context: ${contextLines.join(" | ")}
Agent response: "${agentText.slice(0, 500)}"

Reply EXACTLY "COMPLETE" or "CONTINUE: <reason>"`;

  try {
    const result = await generateText({
      model: cerebras.chat(toCerebrasModelId("zai-glm-4.7")),
      prompt: system,
      temperature: 0,
      maxOutputTokens: 100,
    });

    const text = result.text.trim();
    if (text === "COMPLETE") return { done: true, message: "" };
    const reason = text.startsWith("CONTINUE:") ? text.slice(9).trim() : text;
    return { done: false, message: reason };
  } catch (e) {
    console.error("[verify] Failed:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return { done: true, message: "" };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages, threadId, config, customSystemPrompt, temperature } = body;
    const modelName = config?.modelName;
    const currentThreadId = threadId || `thread_${Date.now()}`;

    const lastThreadId = await getLastThreadId();
    if (lastThreadId && lastThreadId !== currentThreadId) {
      const { readSession } = await import("@/lib/memory/session-store");
      const prevSession = await readSession(lastThreadId);
      if (prevSession?.transcript) {
        await extractAndStoreMemories(prevSession.transcript);
        cleanupMemories().catch(() => {});
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

    saveSession(currentThreadId, title, "", transcript, true).catch(() => {});
    await setLastThreadId(currentThreadId);

    const uiMessages = messages as any[];
    const originalRequest = extractUserRequest(uiMessages);

    const stream = createUIMessageStream({
      originalMessages: uiMessages,
      execute: async ({ writer }) => {
        let currentUIMessages = uiMessages;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const modelMessages = await convertToModelMessages(currentUIMessages);

            const agent = await createAgent({
              messages: modelMessages,
              threadId: currentThreadId,
              modelName,
              customSystemPrompt: customSystemPrompt || undefined,
              temperature: temperature !== undefined ? Number(temperature) : undefined,
            });

            const uiStream = agent.toUIMessageStream({
              originalMessages: currentUIMessages,
            });

            const reader = uiStream.getReader();
            let textOutput = "";
            let streamFailed = false;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value.type === "text-delta") textOutput += value.delta;
                writer.write(value);
              }
            } catch (e) {
              console.error("[bgcheck] Stream read error:", e);
              streamFailed = true;
            } finally {
              reader.releaseLock();
            }

            if (textOutput) {
              try {
                const verify = await verifyCompletion(originalRequest, currentUIMessages, textOutput);
                if (!verify.done) {
                  console.error("[bgcheck] Agent wrote text but task incomplete:", verify.message);
                }
              } catch (e) {
                console.error("[bgcheck] Verify error (non-fatal):", e);
              }
              break;
            }

            if (streamFailed && attempt < 2) continue;
            break;
          } catch (e) {
            console.error(`[bgcheck] Attempt ${attempt + 1} error:`, e);
            if (attempt < 2) continue;
          }
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    const detail = {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack.split("\n").slice(0, 6).join("\n") } : {}),
      ...(error instanceof Error && "cause" in error ? { cause: String(error.cause) } : {}),
    };
    console.error("--- CHAT API ERROR ---");
    console.error(JSON.stringify(detail, null, 2));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    console.error("--- END CHAT API ERROR ---");

    const stream = createUIMessageStream({
      originalMessages: [],
      execute: async ({ writer }) => {
        await writer.write({ type: "text-start", id: "error-text" });
        await writer.write({
          type: "text-delta",
          id: "error-text",
          delta:
            `Error [${detail.name}]: ${detail.message}` +
            (detail.cause ? `\nCause: ${detail.cause}` : ""),
        });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}

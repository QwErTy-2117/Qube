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

process.on("unhandledRejection", (reason) => {
  console.error("[process-unhandledRejection]", reason instanceof Error ? `${reason.name}: ${reason.message}\n${reason.stack}` : String(reason));
});

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
  let last = "Complete the user's request.";
  for (const m of messages) {
    if (m.role === "user") {
      const text = extractText(m);
      if (text) last = text.slice(0, 500);
    }
  }
  return last;
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

  const system = `You are a task completion verifier. Reply EXACTLY "COMPLETE" or "CONTINUE: <reason>".`;

  const prompt = `Request: "${request}"
Context: ${contextLines.join(" | ")}
Agent response: "${agentText.slice(0, 500)}"`;

  try {
    const result = await generateText({
      model: cerebras.chat(toCerebrasModelId("gpt-oss-120b")),
      system,
      prompt,
      temperature: 0,
      maxOutputTokens: 100,
    });

    const text = result.text.trim();
    if (text.includes("COMPLETE")) return { done: true, message: "" };
    if (text.startsWith("CONTINUE:")) {
      return { done: false, message: text.slice(9).trim() };
    }
    if (text.includes("CONTINUE")) {
      const idx = text.indexOf("CONTINUE");
      return { done: false, message: text.slice(idx + 8).trim() };
    }
    return { done: true, message: "" };
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

    const rawStream = createUIMessageStream({
      originalMessages: uiMessages,
      onError: (error) => {
        const stack = error instanceof Error ? error.stack : new Error().stack;
        console.error("[stream-error:S1] onError called with:", error instanceof Error ? `${error.name}: ${error.message}` : String(error), "\n  captured stack:", stack?.split("\n").slice(1, 4).join("\n  "));
        return "An error occurred.";
      },
      execute: async ({ writer }) => {
        let currentUIMessages = uiMessages;

        for (let attempt = 0; attempt < 10; attempt++) {
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
            const assistantParts: any[] = [];
            const textBuf = new Map<string, string>();
            const pendingCalls = new Map<string, any>();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const v = value as any;
                if (v.type === "text-delta") textOutput += v.delta;
                if (v.type === "text-start") textBuf.set(v.id, "");
                if (v.type === "text-delta") {
                  const b = textBuf.get(v.id);
                  if (b !== undefined) textBuf.set(v.id, b + v.delta);
                }
                if (v.type === "text-end") {
                  assistantParts.push({ type: "text", text: textBuf.get(v.id) || "" });
                  textBuf.delete(v.id);
                }
                if (v.type === "tool-call-start") {
                  pendingCalls.set(v.toolCallId, { toolName: v.toolName, args: v.args });
                }
                if (v.type === "tool-result") {
                  const p = pendingCalls.get(v.toolCallId);
                  if (p) {
                    assistantParts.push({
                      type: "tool-call", toolCallId: v.toolCallId,
                      toolName: v.toolName, args: p.args, state: "complete",
                    });
                    pendingCalls.delete(v.toolCallId);
                  } else {
                    assistantParts.push({
                      type: "tool-call", toolCallId: v.toolCallId,
                      toolName: v.toolName, args: {}, state: "complete",
                    });
                  }
                  assistantParts.push({
                    type: "tool-result", toolCallId: v.toolCallId,
                    toolName: v.toolName, result: v.result, state: v.isError ? "error" : "complete",
                    isError: v.isError,
                  });
                }
                if (v.type === "tool-call-end") {
                  const p = pendingCalls.get(v.toolCallId);
                  if (p && p.args && v.args) p.args = v.args;
                }
                writer.write(v);
              }
            } catch (e) {
              console.error("[bgcheck] Stream read error:", e);
            } finally {
              reader.releaseLock();
            }

            const textToVerify = textOutput || (assistantParts.length > 0 ? "[Tool calls made, no text before timeout]" : "");
            try {
              const verify = await verifyCompletion(originalRequest, currentUIMessages, textToVerify);
              if (!verify.done) {
                if (attempt < 9) {
                  console.log(`[bgcheck] Attempt ${attempt + 1} incomplete (verify: ${verify.message}), retrying`);
                  const assistantMsg = assistantParts.length > 0
                    ? [{ role: "assistant", parts: assistantParts }]
                    : [];
                  currentUIMessages = [...currentUIMessages, ...assistantMsg, {
                    role: "user",
                    parts: [{ type: "text", text: `[System: CONTINUE: ${verify.message}]` }],
                  }];
                  continue;
                }
                console.error(`[bgcheck] Last attempt (${attempt + 1}) still incomplete:`, verify.message);
              }
            } catch (e) {
              console.error("[bgcheck] Verify error (non-fatal):", e);
            }
            break;
          } catch (e) {
            console.error(`[bgcheck] Attempt ${attempt + 1} error:`, e);
            if (attempt < 9) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
              console.log(`[bgcheck] Backoff ${delay}ms before retry`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
        }
      },
    });

    const stream = rawStream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "error") {
          console.error("[stream-pipeline:S2] Error chunk flowing through pipe:", chunk.errorText);
        }
        controller.enqueue(chunk);
      },
      flush() {
        console.log("[stream-pipeline:S3] Pipe flush complete");
      },
    }));

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

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

function extractContext(m: any): string {
  if (typeof m.content === "string" && m.content) return m.content.slice(0, 200);
  const parts = (m.parts || []) as any[];
  return parts.map((p: any) => {
    if (p.type === "text") return (p.text || "").slice(0, 200);
    if (p.type === "tool-result") return `[tool result: ${(p.result || "").slice(0, 150)}]`;
    if (p.type === "tool-call") return `[tool call: ${p.toolName}]`;
    return "";
  }).filter(Boolean).join(" | ").slice(0, 300);
}

async function verifyCompletion(
  request: string,
  prevMessages: any[],
  agentText: string,
  streamEndedNaturally: boolean,
): Promise<{ done: boolean; message: string }> {
  const contextLines = prevMessages.slice(-6).map(extractContext).filter(Boolean);
  const hasToolResults = prevMessages.some((m: any) => {
    const parts = (m.parts || []) as any[];
    return parts.some((p: any) => p.type === "tool-result");
  });
  const hasDeliveryText = agentText.length > 50 && !agentText.startsWith("[Tool calls made,");

  // Hardcoded guard: agent made tool calls but never addressed the user
  if (hasToolResults && !hasDeliveryText) {
    const hasFileOutput = prevMessages.some((m: any) => {
      const parts = (m.parts || []) as any[];
      return parts.some((p: any) => p.type === "tool-result" && (
        typeof p.result === "string" && (p.result.includes("written") || p.result.includes("exitCode"))
      ));
    });
    const reason = hasFileOutput
      ? "The file was created but you did not tell the user. Write your final response now. Do NOT make any more tool calls."
      : "You have data but did not deliver the answer. Write your final response now.";
    return { done: false, message: reason };
  }

  const hasSearchAfterWork = prevMessages.some((m: any) => {
    const parts = (m.parts || []) as any[];
    const toolNames = parts.filter(p => p.type === "tool-call").map(p => p.toolName);
    return toolNames.includes("web_search") || toolNames.includes("web_fetch");
  });

  const prompt = `Request: "${request}"
Context: ${contextLines.join(" | ")}
Agent text: "${(agentText || "(no text yet)").slice(0, 500)}"
Has tool results: ${hasToolResults}
Delivered: ${hasDeliveryText}
COMPLETE or CONTINUE: what's missing?`;

  try {
    const result = await generateText({
      model: cerebras.chat("zai-glm-4.7"),
      maxRetries: 0,
      system: "COMPLETE if agent wrote the answer. CONTINUE: <what's missing> otherwise.",
      prompt,
      temperature: 0,
      maxOutputTokens: 60,
    });

    const text = result.text.trim();
    if (text.includes("COMPLETE")) return { done: true, message: "" };
    if (text.startsWith("CONTINUE:")) return { done: false, message: text.slice(9).trim() };
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
        extractAndStoreMemories(prevSession.transcript).catch(() => {});
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
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const stack = error instanceof Error ? error.stack : new Error().stack;
        console.error("[stream-error:S1] onError called with:", errMsg, "\n  captured stack:", stack?.split("\n").slice(1, 4).join("\n  "));
        return `Error [${errMsg}]`;
      },
      execute: async ({ writer }) => {
        let currentUIMessages = uiMessages;

        let loopExhausted = false;
        let hasAnyToolResults = false;
        let lastWasRateLimit = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          if (lastWasRateLimit) {
            console.log(`[bgcheck] Waiting 60s after rate limit before retry ${attempt + 1}...`);
            await new Promise(r => setTimeout(r, 60000));
            lastWasRateLimit = false;
          }
          try {
            const modelMessages = await convertToModelMessages(currentUIMessages);

            const agent = await createAgent({
              messages: modelMessages,
              threadId: currentThreadId,
              modelName,
              customSystemPrompt,
              temperature: temperature !== undefined ? Number(temperature) : undefined,
            });

            const uiStream = agent.toUIMessageStream({
              originalMessages: currentUIMessages,
            });

            const reader = uiStream.getReader();
            let textOutput = "";
            let streamEndedNaturally = false;
            const assistantParts: any[] = [];
            const textBuf = new Map<string, string>();
            const pendingCalls = new Map<string, any>();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) { streamEndedNaturally = true; break; }
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
                if (v.type === "tool-result") hasAnyToolResults = true;
                writer.write(v);
              }
            } catch (e) {
              const err = e as any;
              const is429 = err?.statusCode === 429 || (err?.errors || []).some((x: any) => x?.statusCode === 429);
              if (is429 || /too many requests|rate limit/i.test(err?.message || "")) {
                lastWasRateLimit = true;
                console.log("[bgcheck] Rate limit on stream");
              } else {
                console.error("[bgcheck] Stream read error:", e);
              }
            } finally {
              reader.releaseLock();
            }

            const textToVerify = textOutput || (assistantParts.length > 0 ? "[Tool calls made, no delivery text]" : "");
            try {
              const verify = await verifyCompletion(originalRequest, currentUIMessages, textToVerify, streamEndedNaturally);
              if (!verify.done) {
                if (attempt < 9) {
                  console.log(`[bgcheck] Attempt ${attempt + 1} incomplete (verify: ${verify.message}), retrying`);
                  const assistantMsg = assistantParts.length > 0
                    ? [{ role: "assistant", parts: assistantParts }]
                    : [];
                  currentUIMessages = [...currentUIMessages, ...assistantMsg, {
                    role: "user",
                    parts: [{ type: "text", text: `[INSTRUCTION] ${verify.message}` }],
                  }];
                  continue;
                }
                loopExhausted = true;
                console.error(`[bgcheck] Last attempt (${attempt + 1}) still incomplete:`, verify.message);
              }
            } catch (e) {
              console.error("[bgcheck] Verify error (non-fatal):", e);
              if (attempt < 9) continue;
              loopExhausted = true;
            }
            break;
          } catch (e) {
            const err = e as any;
            const isRateLimit = err?.statusCode === 429 || (err?.errors || []).some((x: any) => x?.statusCode === 429) || /too many requests|rate limit|token_quota_exceeded/i.test(err?.message || "");
            if (isRateLimit) {
              lastWasRateLimit = true;
              console.log(`[bgcheck] Attempt ${attempt + 1} rate limited`);
            } else {
              console.error(`[bgcheck] Attempt ${attempt + 1} error:`, e);
            }
            if (attempt < 9) {
              if (!isRateLimit) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                console.log(`[bgcheck] Backoff ${delay}ms before retry`);
                await new Promise(r => setTimeout(r, delay));
              }
              continue;
            }
            loopExhausted = true;
          }
        }

        // Fallback: retries exhausted with tool results but no delivery text
        if (loopExhausted && hasAnyToolResults) {
          writer.write({ type: "text-start", id: "fallback" });
          writer.write({ type: "text-delta", id: "fallback", delta: "\n\n*(The agent gathered data but ran out of retries while drafting the final response. The tool results above show what was collected.)*" });
          writer.write({ type: "text-end", id: "fallback" });
        } else if (loopExhausted && !hasAnyToolResults) {
          writer.write({ type: "text-start", id: "fallback" });
          writer.write({ type: "text-delta", id: "fallback", delta: "\n\n*(The AI service is temporarily unavailable. Please try again in a moment.)*" });
          writer.write({ type: "text-end", id: "fallback" });
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

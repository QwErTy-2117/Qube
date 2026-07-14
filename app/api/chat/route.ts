import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
} from "ai";
import { createModelClient } from "@/lib/agent/model-client";
import { hasVisionCapability } from "@/lib/agent/agent";

export const maxDuration = 120;

process.on("unhandledRejection", (reason) => {
  console.error("[process-unhandledRejection]", reason instanceof Error ? `${reason.name}: ${reason.message}\n${reason.stack}` : String(reason));
});

const _dynCache = new Map<string, any>();
async function loadSessionStore() {
  if (!_dynCache.has("session-store")) _dynCache.set("session-store", import("@/lib/memory/session-store"));
  return _dynCache.get("session-store");
}
async function loadSessionTracker() {
  if (!_dynCache.has("session-tracker")) _dynCache.set("session-tracker", import("@/lib/memory/session-tracker"));
  return _dynCache.get("session-tracker");
}
async function loadMemoryAgent() {
  if (!_dynCache.has("memory-agent")) _dynCache.set("memory-agent", import("@/lib/agent/memory-agent"));
  return _dynCache.get("memory-agent");
}
async function loadAgent() {
  if (!_dynCache.has("agent")) _dynCache.set("agent", import("@/lib/agent/agent"));
  return _dynCache.get("agent");
}

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

function stripOldScreenshots(messages: any[], keepCount: number = 2): any[] {
  const screenshotMsgIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const parts = (messages[i].parts || []) as any[];
    if (parts.some((p: any) => p.type === "tool-result" && (p.toolName === "get_app_state" || p.toolName === "computer_screenshot"))) {
      screenshotMsgIndices.push(i);
    }
  }
  if (screenshotMsgIndices.length <= keepCount) return messages;
  const toStrip = new Set(screenshotMsgIndices.slice(0, -keepCount));
  return messages.map((m, i) => {
    if (!toStrip.has(i)) return m;
    return {
      ...m,
      parts: (m.parts || []).map((p: any) => {
        if (p.type === "tool-result" && (p.toolName === "get_app_state" || p.toolName === "computer_screenshot")) {
          return { ...p, result: JSON.stringify({ placeholder: true, message: "Older screenshot removed to save context" }) };
        }
        return p;
      }),
    };
  });
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

function computeRateLimitDelay(err: any): number {
  try {
    if (typeof err?.responseBody === "string") {
      const body = JSON.parse(err.responseBody);
      if (typeof body.retry_after === "number") return body.retry_after * 1000;
      if (typeof body.retryAfter === "number") return body.retryAfter * 1000;
    }
  } catch {}
  if (typeof err?.retryAfter === "number") return err.retryAfter * 1000;
  if (typeof err?.retry_after === "number") return err.retry_after * 1000;
  const msg = err?.message || "";
  if (/token_quota_exceeded/i.test(msg)) return 65000;
  return 60000;
}

async function verifyCompletion(
  request: string,
  prevMessages: any[],
  agentText: string,
  streamEndedNaturally: boolean,
  modelName: string,
): Promise<{ done: boolean; message: string }> {
  const contextLines = prevMessages.slice(-6).map(extractContext).filter(Boolean);
  const hasToolResults = prevMessages.some((m: any) => {
    const parts = (m.parts || []) as any[];
    return parts.some((p: any) => p.type === "tool-result");
  });
  const hasDeliveryText = agentText.length > 50 && !agentText.startsWith("[Tool calls made,");

  const canUseComputer = hasVisionCapability(modelName);

  // Check for tool errors (broken tools, permission denied, etc.)
  const hasToolErrors = prevMessages.some((m: any) => {
    const parts = (m.parts || []) as any[];
    return parts.some((p: any) => p.type === "tool-result" && (
      p.isError || (typeof p.result === "string" && (
        p.result.includes('"error":true') || p.result.includes('"error": true')
      ))
    ));
  });

  // Hardcoded guard: agent made tool calls but never addressed the user
  if (hasToolResults && !hasDeliveryText) {
    const hasFileOutput = prevMessages.some((m: any) => {
      const parts = (m.parts || []) as any[];
      return parts.some((p: any) => p.type === "tool-result" && (
        typeof p.result === "string" && (p.result.includes("written") || p.result.includes("exitCode"))
      ));
    });
    // If all tool calls failed with errors, the agent explaining that is valid delivery
    if (hasToolErrors) return { done: true, message: "" };
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

  const computerNote = canUseComputer
    ? "Model has vision — computer control tools are available."
    : "Model LACKS vision — computer control tools are NOT available. Do NOT expect the agent to use them.";

  const prompt = `Request: "${request}"
Context: ${contextLines.join(" | ")}
Agent text: "${(agentText || "(no text yet)").slice(0, 500)}"
Has tool results: ${hasToolResults}
Delivered: ${hasDeliveryText}
Tool errors: ${hasToolErrors ? "YES — the agent encountered tool failures" : "none"}
${computerNote}
COMPLETE if agent answered OR explained why it cannot proceed. CONTINUE: <what's missing> otherwise.`;

  try {
    const result = await generateText({
      model: createModelClient(modelName),
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
  console.log("[chat] POST /api/chat start", { url: req.url });
  try {
    const body = await req.json();
    const { messages, threadId, config, customSystemPrompt, temperature, userName, userAbout, instanceId } = body;
    const modelName = config?.modelName;
    const currentThreadId = threadId || `thread_${Date.now()}`;

    const { getLastThreadId, setLastThreadId } = await loadSessionTracker();
    const { saveSession, readSession } = await loadSessionStore();
    const { extractAndStoreMemories, cleanupMemories } = await loadMemoryAgent();

    const lastThreadId = await getLastThreadId();
    if (lastThreadId && lastThreadId !== currentThreadId) {
      const prevSession = await readSession(lastThreadId);
      if (prevSession?.transcript) {
        try {
          const memModel = createModelClient(modelName);
          extractAndStoreMemories(prevSession.transcript, memModel).catch(() => {});
          cleanupMemories(memModel).catch(() => {});
        } catch {}
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
        try {
        let currentUIMessages = uiMessages;

        let loopExhausted = false;
        let hasAnyToolResults = false;
        let lastWasRateLimit = false;
        let lastRateLimitDelayMs = 0;
        let lastError: string | null = null;
        let generalAttempts = 0;
        let rateLimitAttempts = 0;
        const MAX_GENERAL = 10;
        const MAX_RATE_LIMIT = 30;

        while (true) {
          generalAttempts++;
          if (lastWasRateLimit) {
            console.log(`[bgcheck] Waiting ${lastRateLimitDelayMs}ms after rate limit before retry ${generalAttempts}...`);
            await new Promise(r => setTimeout(r, lastRateLimitDelayMs));
            lastWasRateLimit = false;
          }
          try {
            currentUIMessages = stripOldScreenshots(currentUIMessages, 2);
            const modelMessages = await convertToModelMessages(currentUIMessages);

            const { createAgent } = await loadAgent();
            const agent = await createAgent({
              messages: modelMessages,
              threadId: currentThreadId,
              modelName,
              customSystemPrompt,
              temperature: temperature !== undefined ? Number(temperature) : undefined,
              userName,
              userAbout,
              instanceId,
            });

            const uiStream = agent.toUIMessageStream({
              originalMessages: currentUIMessages,
              onError: (error: any) => JSON.stringify({
                statusCode: error?.statusCode,
                message: error?.message,
                responseBody: error?.responseBody,
              }),
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
                if (v.type === "error") {
                  let errData: any = {};
                  try { errData = JSON.parse(v.errorText); } catch {}
                  const isRateLimit = errData?.statusCode === 429 || /too many|rate limit|token_quota/i.test(errData?.message || "");
                  if (isRateLimit) {
                    lastWasRateLimit = true;
                    lastRateLimitDelayMs = computeRateLimitDelay(errData);
                    break;
                  }
                  writer.write(v);
                  break;
                }
                writer.write(v);
              }
            } catch (e) {
              const err = e as any;
              const is429 = err?.statusCode === 429 || (err?.errors || []).some((x: any) => x?.statusCode === 429);
              if (is429 || /too many requests|rate limit|token_quota_exceeded/i.test(err?.message || "")) {
                lastWasRateLimit = true;
                lastRateLimitDelayMs = computeRateLimitDelay(err);
                console.log("[bgcheck] Rate limit on stream (delay: " + lastRateLimitDelayMs + "ms)");
              } else {
                console.error("[bgcheck] Stream read error:", e);
              }
            } finally {
              reader.releaseLock();
            }

            if (lastWasRateLimit) {
              rateLimitAttempts++;
              if (rateLimitAttempts >= MAX_RATE_LIMIT) {
                loopExhausted = true;
                break;
              }
              continue;
            }

            const textToVerify = textOutput || (assistantParts.length > 0 ? "[Tool calls made, no delivery text]" : "");
            try {
              const verify = await verifyCompletion(originalRequest, currentUIMessages, textToVerify, streamEndedNaturally, modelName);
              if (!verify.done) {
                if (generalAttempts < MAX_GENERAL) {
                  console.log(`[bgcheck] Attempt ${generalAttempts} incomplete (verify: ${verify.message}), retrying`);
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
                console.error(`[bgcheck] Last attempt (${generalAttempts}) still incomplete:`, verify.message);
              }
            } catch (e) {
              console.error("[bgcheck] Verify error (non-fatal):", e);
              if (generalAttempts < MAX_GENERAL) continue;
              loopExhausted = true;
            }
            break;
          } catch (e) {
            const err = e as any;
            const isRateLimit = err?.statusCode === 429 || (err?.errors || []).some((x: any) => x?.statusCode === 429) || /too many requests|rate limit|token_quota_exceeded/i.test(err?.message || "");
            if (isRateLimit) {
              lastWasRateLimit = true;
              lastRateLimitDelayMs = computeRateLimitDelay(err);
              rateLimitAttempts++;
              console.log(`[bgcheck] Attempt ${generalAttempts} rate limited (delay: ${lastRateLimitDelayMs}ms, rateLimit: ${rateLimitAttempts}/${MAX_RATE_LIMIT})`);
              if (rateLimitAttempts >= MAX_RATE_LIMIT) {
                loopExhausted = true;
                break;
              }
              continue;
            }
            console.error(`[bgcheck] Attempt ${generalAttempts} error:`, e);
            lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
            if (generalAttempts < MAX_GENERAL) {
              const delay = Math.min(1000 * Math.pow(2, generalAttempts - 1), 8000);
              console.log(`[bgcheck] Backoff ${delay}ms before retry`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            loopExhausted = true;
            break;
          }
        }

        // Fallback: retries exhausted with tool results but no delivery text
        if (loopExhausted && hasAnyToolResults) {
          writer.write({ type: "text-start", id: "fallback" });
          writer.write({ type: "text-delta", id: "fallback", delta: "\n\n*(The agent gathered data but ran out of retries while drafting the final response. The tool results above show what was collected.)*" });
          writer.write({ type: "text-end", id: "fallback" });
        } else if (loopExhausted && !hasAnyToolResults && !lastWasRateLimit) {
          writer.write({ type: "text-start", id: "fallback" });
          const fbMsg = lastError
            ? `\n\n*(The AI service is temporarily unavailable. Please try again in a moment.)*\n\n**Debug:** ${lastError}`
            : "\n\n*(The AI service is temporarily unavailable. Please try again in a moment.)*";
          writer.write({ type: "text-delta", id: "fallback", delta: fbMsg });
          writer.write({ type: "text-end", id: "fallback" });
        }
      } catch (e) {
        // Nuclear backstop: any error that escapes all other catches writes a text-delta
        try { writer.write({ type: "text-start", id: "fallback" }); } catch {}
        try { writer.write({ type: "text-delta", id: "fallback", delta: "\n\n*(The AI service is temporarily unavailable. Please try again in a moment.)*" }); } catch {}
        try { writer.write({ type: "text-end", id: "fallback" }); } catch {}
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

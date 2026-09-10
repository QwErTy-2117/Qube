import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { runPiHarness } from "@/lib/pi/harness";

export const maxDuration = 300;

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
        if (typeof (p as any).text === "string") return (p as any).text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export async function POST(req: Request) {
  console.log("[chat] POST /api/chat start (Pi harness)", { url: req.url });
  try {
    const body = await req.json();
    const { messages, id, threadId, qubeThreadId, memoryEnabled, config, customSystemPrompt, temperature, instanceId, mcpServers, skills, allowedDirs, userName, userAbout } = body;
    const modelName = config?.modelName;
    const reasoningEffort = config?.reasoningEffort;
    // Prefer the transport thread id (the remote thread id in the
    // adapter model) so sessions accumulate per chat; fall back to the
    // legacy app-level id, then to a fresh id.
    const currentThreadId =
      (typeof id === "string" && id) ||
      (typeof qubeThreadId === "string" && qubeThreadId) ||
      threadId ||
      `thread_${Date.now()}`;

    // If MCP servers provided per-request, sync to store for persistence
    if (Array.isArray(mcpServers) && mcpServers.length >= 0) {
      try {
        const { mcpStore } = await import("@/lib/pi/mcp-store");
        mcpStore.sync(mcpServers);
      } catch {}
    }

    // If skills provided per-request, sync to store for persistence (Pi harness)
    if (Array.isArray(skills) && skills.length >= 0) {
      try {
        const { skillStore } = await import("@/lib/skills/store");
        skillStore.sync(skills);
      } catch {}
    }

    // If allowed directories provided per-request, sync to store for enforcement
    if (Array.isArray(allowedDirs) && allowedDirs.length >= 0) {
      try {
        const { allowedDirsStore } = await import("@/lib/permissions/allowed-dirs");
        allowedDirsStore.sync(allowedDirs);
      } catch {}
    }

    // Persist session for history (lightweight, no checkpoint/goals).
    // Never overwrite a meaningful existing title (manual/agent renames win).
    try {
      const { saveSession, readSession } = await import("@/lib/memory/session-store");
      const { setLastThreadId } = await import("@/lib/memory/session-tracker");
      const { isPlaceholderTitle } = await import("@/lib/chat/thread-snapshots");
      const transcript = (messages || [])
        .map((m: any) => `${m.role}: ${extractText(m)}`)
        .join("\n");
      const firstMsg = messages?.find((m: any) => m.role === "user") || {};
      const firstParts = (firstMsg.parts || firstMsg.content || []) as any[];
      const derived = Array.isArray(firstParts)
        ? firstParts.map((p: any) => p.text || "").filter(Boolean).join(" ").slice(0, 80) || "Conversation"
        : "Conversation";
      const existing = await readSession(currentThreadId).catch(() => null);
      const title =
        existing && !isPlaceholderTitle(existing.title) ? existing.title : derived;
      // Skip empty pings so partial saves never wipe a real transcript.
      if (transcript.trim() || !existing?.hasTranscript) {
        saveSession(currentThreadId, title, existing?.summary || "", transcript || (existing as any)?.transcript, true).catch(() => {});
      }
      setLastThreadId(currentThreadId).catch(() => {});
    } catch {}

    const uiMessages = messages as any[];

    const rawStream = createUIMessageStream({
      originalMessages: uiMessages,
      onError: (error) => {
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.error("[chat] stream onError:", errMsg);
        return `Error [${errMsg}]`;
      },
      execute: async ({ writer }) => {
        try {
          await runPiHarness(writer, {
            messages: uiMessages,
            threadId: currentThreadId,
            modelName,
            customSystemPrompt,
            temperature: temperature !== undefined ? Number(temperature) : undefined,
            reasoningEffort,
            request: req,
            mcpServers: Array.isArray(mcpServers) ? mcpServers : undefined,
            instanceId: typeof instanceId === "string" ? instanceId : undefined,
            skills: Array.isArray(skills) ? skills : undefined,
            userName: typeof userName === "string" ? userName : undefined,
            userAbout: typeof userAbout === "string" ? userAbout : undefined,
            memoryEnabled: typeof memoryEnabled === "boolean" ? memoryEnabled : undefined,
          });
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          console.error("[chat] runPiHarness failed:", msg);
          try {
            writer.write({ type: "text-start", id: "error" } as any);
            writer.write({ type: "text-delta", id: "error", delta: `Error: ${msg}` } as any);
            writer.write({ type: "text-end", id: "error" } as any);
          } catch {}
        }
      },
    });

    const stream = rawStream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          if ((chunk as any).type === "error") {
            console.error("[chat] Error chunk:", (chunk as any).errorText);
          }
          controller.enqueue(chunk);
        },
      })
    );

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    const detail = {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
    console.error("--- CHAT API ERROR (Pi) ---", JSON.stringify(detail, null, 2));
    const stream = createUIMessageStream({
      originalMessages: [],
      execute: async ({ writer }) => {
        await writer.write({ type: "text-start", id: "error-text" } as any);
        await writer.write({
          type: "text-delta",
          id: "error-text",
          delta: `Error [${detail.name}]: ${detail.message}`,
        } as any);
        await writer.write({ type: "text-end", id: "error-text" } as any);
      },
    });
    return createUIMessageStreamResponse({ stream });
  }
}

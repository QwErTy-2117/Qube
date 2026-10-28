import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { runPiHarness } from "@/lib/pi/harness";
import { currentSchedulerEpoch } from "@/lib/scheduler/runtime-state";
import { normalizeAttachmentsForModel } from "@/lib/chat/attachment-model";

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

const RESEARCH_TOOL_RE = /(web_|browser_|subagent|search|fetch|read_|list_|get_|research|gmail|github|notion|drive)/i;
const RESEARCH_INTENT_RE = /(research|find|look up|check|compare|latest|investigate|what|why|how|when|where|source|summary|report)/i;

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown>;
    if (m?.role !== "user") continue;
    const text = extractText(m).trim();
    if (text) return text.slice(0, 1000);
  }
  return "";
}

function deriveResearchTopic(userText: string): string {
  const clean = String(userText || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/^\s*(can you|could you|please|research|find|look up|check|tell me|what|why|how|when|where|about|the|a|an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ");
  return clean ? clean.slice(0, 80) : "Chat research";
}

interface AnnouncementTurn {
  writer: any;
  replyText: () => string;
  finalize: () => Promise<void>;
  release: () => Promise<void>;
}

/**
 * Verify delivery from VISIBLE text. Claims were taken before prompt building;
 * only mentioned items become delivered. A failed/generic turn releases its
 * claims and leaves every item pending for another chat or a restart. Research
 * actually communicated in this normal chat is recorded as a delivered fact,
 * so heartbeat/scheduled work cannot later present it as fresh news.
 */
function watchAnnouncementDelivery(
  writer: any,
  pending: any[],
  threadId: string,
  userText: string,
): AnnouncementTurn {
  let replyText = "";
  let hadError = false;
  let finalized = false;
  // A hard reset increments the epoch. A stream that began before the reset
  // must not write old announcement receipts into the fresh ledger.
  const startEpoch = currentSchedulerEpoch();
  const resetDuringTurn = () => currentSchedulerEpoch() !== startEpoch;
  const toolNames = new Set<string>();
  const origWrite = writer.write.bind(writer);
  try {
    writer.write = (chunk: any) => {
      try {
        if (chunk?.type === "text-delta" && typeof chunk?.delta === "string") replyText += chunk.delta;
        if (chunk?.type === "error" || chunk?.errorText) hadError = true;
        const name = chunk?.toolName || chunk?.name || chunk?.tool_name || chunk?.toolCallName;
        if (typeof name === "string") toolNames.add(name);
        if (typeof chunk?.type === "string" && chunk.type.includes("tool")) {
          const raw = chunk.type.match(/(?:dynamic-tool|tool)-?([a-z0-9_-]+)/i)?.[1];
          if (raw) toolNames.add(raw);
        }
      } catch {}
      return origWrite(chunk);
    };
  } catch {}

  const release = async () => {
    if (pending.length === 0 || resetDuringTurn()) return;
    try {
      const { releaseAnnouncementClaims } = await import("@/lib/scheduler/announcements");
      await releaseAnnouncementClaims(pending.map((p) => String(p.id)), threadId);
    } catch {}
  };

  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    if (resetDuringTurn()) return;
    const visible = replyText.trim();
    if (hadError || visible.length < 8) {
      await release();
      return;
    }
    try {
      const ledger = await import("@/lib/scheduler/announcements");
      const marked = pending.length > 0
        ? await ledger.markAnnouncementsDeliveredIfMentioned(pending, visible, { threadId })
        : [];
      if (pending.length > 0 && marked.length < pending.length) {
        console.log(`[chat] Announcements verified ${marked.length}/${pending.length} mentioned — rest stay pending`);
      }
      try {
        const { markNotified } = await import("@/lib/scheduler/heartbeat-state");
        for (const p of pending) {
          if (marked.includes(String(p.id)) || ledger.announcementMentionedInReply(p, visible)) {
            await markNotified(String(p.taskName || p.topic || "announcement")).catch(() => {});
          }
        }
      } catch {}

      const researchTool = [...toolNames].some((n) => RESEARCH_TOOL_RE.test(n));
      const researchIntent = RESEARCH_INTENT_RE.test(userText);
      if (visible.length >= 40 && (researchTool || researchIntent) && marked.length === 0) {
        await ledger.recordDeliveredChatFinding({
          threadId,
          topic: deriveResearchTopic(userText),
          summary: visible.slice(0, 600),
          replyText: visible,
          metadata: { toolNames: [...toolNames].slice(0, 12), source: "normal-chat" },
        });
      }
      if (pending.length > 0) await release();
    } catch (e) {
      console.warn("[chat] announcement delivery finalize failed (non-fatal):", e);
      await release();
    }
  };

  return { writer, replyText: () => replyText, finalize, release };
}

export async function POST(req: Request) {
  console.log("[chat] POST /api/chat start (Pi harness)", { url: req.url });
  let claimedAnnouncements: any[] = [];
  let activeThreadId = "";
  const requestEpoch = currentSchedulerEpoch();
  // Explicit scheduler boot (audit fix #10): the tick must not depend on a
  // lazy client task-list load. Idempotent — startScheduler guards re-entry.
  // Isolation: ticks run sequentially (running flag) so a long heartbeat LLM
  // run never overlaps the next tick or starves scheduled tasks mid-run.
  try {
    const { ensureSchedulerStarted } = await import("@/lib/scheduler/init");
    ensureSchedulerStarted();
  } catch {}
  try {
    const body = await req.json();
    const { messages, id, threadId, qubeThreadId, memoryEnabled, config, customSystemPrompt, temperature, instanceId, mcpServers, skills, allowedDirs, userName, userAbout } = body;
    let modelName = config?.modelName;
    const reasoningEffort = config?.reasoningEffort;
    // Self-heal stale ChatGPT defaults: the stored default (e.g. chatgpt:gpt-5.5)
    // may no longer exist on the user's plan — upstream then 404s with
    // "does not exist or you do not have access". Remap to the account's
    // first live model so subscription chats keep working after renames.
    if (typeof modelName === "string" && modelName.startsWith("chatgpt:")) {
      try {
        const { chatGptAuth } = await import("@/lib/chatgpt/handler");
        const { pickChatGPTModel } = await import("@/lib/chatgpt/models");
        const live = await chatGptAuth.getModels(req as any).catch(() => undefined);
        if (Array.isArray(live) && live.length > 0) {
          const slug = modelName.split(":").slice(1).join(":");
          const replacementSlug = pickChatGPTModel(live, slug);
          if (replacementSlug && replacementSlug !== slug) {
            const replacement = `chatgpt:${replacementSlug}`;
            console.warn(`[chat] ChatGPT model "${modelName}" not on this plan — remapping to "${replacement}" (plan models: ${live.slice(0, 8).join(", ")})`);
            modelName = replacement;
          }
        }
      } catch {}
    }
    // Prefer the transport thread id (the remote thread id in the
    // adapter model) so sessions accumulate per chat; fall back to the
    // legacy app-level id, then to a fresh id.
    const currentThreadId =
      (typeof id === "string" && id) ||
      (typeof qubeThreadId === "string" && qubeThreadId) ||
      threadId ||
      `thread_${Date.now()}`;
    activeThreadId = String(currentThreadId);

    // Keep the original UIMessages for the client stream and history, but send
    // a normalized copy to the model. Unsupported attachment MIME types become
    // fenced untrusted text and their bytes are saved in the workspace, so a
    // sent/restored/retried attachment cannot trigger a provider file-part
    // error. Images and PDFs remain inline for providers that support them.
    let modelMessages = Array.isArray(messages) ? messages as any[] : [];
    try {
      modelMessages = await normalizeAttachmentsForModel(modelMessages, {
        threadId: String(currentThreadId),
      });
    } catch (error) {
      console.warn("[chat] attachment normalization failed (non-fatal):", (error as Error)?.message || String(error));
      modelMessages = Array.isArray(messages) ? messages as any[] : [];
    }
    const latestUserText = lastUserText(modelMessages);

    if (process.env.PI_DURABLE_ENABLED === "1") {
      const { streamDurableToWriter, buildRequestId } = await import("@/lib/pi/durable-stream");
      const last = modelMessages.length > 0 ? modelMessages[modelMessages.length - 1] : null;
      const text = last ? extractText(last as Record<string, unknown>) : "";
      const durableStream = createUIMessageStream({
        originalMessages: (messages ?? []) as any[],
        execute: async ({ writer }) => {
          const turn = watchAnnouncementDelivery(writer, claimedAnnouncements, activeThreadId, latestUserText);
          try {
            await streamDurableToWriter(currentThreadId, text, buildRequestId(currentThreadId, String(Date.now())), turn.writer as never, {
              modelName,
              reasoningEffort: typeof reasoningEffort === "string" ? reasoningEffort : undefined,
              instanceId: typeof instanceId === "string" ? instanceId : undefined,
              signal: req.signal ?? undefined,
              // Foreground user chat: kernel-gated tools may raise the approval
              // card instead of denying outright.
              interactive: true,
            });
            await turn.finalize();
          } catch (e) {
            await turn.release();
            const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
            if (!/abort/i.test(msg)) {
              try {
                writer.write({ type: "text-start", id: "error" } as any);
                writer.write({ type: "text-delta", id: "error", delta: `Error: ${msg}` } as any);
                writer.write({ type: "text-end", id: "error" } as any);
              } catch {}
            }
          }
        },
      });
      return createUIMessageStreamResponse({ stream: durableStream });
    }

    // Claim BEFORE the prompt is built. A second chat sees an active lease,
    // so the same pending announcement cannot be injected into two replies.
    // The durable path has no dynamic announcement section yet; it leaves
    // items pending and still records its own normal-chat research as delivered.
    try {
      const { claimPendingAnnouncements } = await import("@/lib/scheduler/announcements");
      claimedAnnouncements = await claimPendingAnnouncements({ limit: 3, threadId: activeThreadId });
    } catch {}

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

    // claimedAnnouncements was snapshotted and claimed BEFORE the durable
    // branch, so the Pi and durable paths share the same global ledger.

    const rawStream = createUIMessageStream({
      originalMessages: uiMessages,
      onError: (error) => {
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.error("[chat] stream onError:", errMsg);
        return `Error [${errMsg}]`;
      },
      execute: async ({ writer }) => {
        const turn = watchAnnouncementDelivery(writer, claimedAnnouncements, activeThreadId, latestUserText);
        try {
          await runPiHarness(turn.writer, {
            messages: modelMessages,
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
          // Verified delivery + normal-chat research dedup happen only after
          // a successful turn with visible reply text.
          await turn.finalize();
        } catch (e) {
          await turn.release();
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
    // A pre-stream failure must not leave an announcement permanently claimed.
    try {
      if (claimedAnnouncements.length > 0 && activeThreadId && currentSchedulerEpoch() === requestEpoch) {
        const { releaseAnnouncementClaims } = await import("@/lib/scheduler/announcements");
        await releaseAnnouncementClaims(claimedAnnouncements.map((a) => String(a.id)), activeThreadId);
      }
    } catch {}
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

/**
 * Qube ACP agent — exposes the Pi harness over the Agent Client Protocol.
 *
 * Editors (Zed, etc.) spawn this over stdio (see ./stdio.ts):
 *   initialize -> session/new -> session/prompt <-> session/update -> ...
 *
 * Prompt execution reuses Qube's model resolution (providerStore),
 * system prompt builder, and MCP loader, but tools are session-scoped
 * (cwd = ACP session cwd) with approval via session/request_permission.
 */

import * as acp from "@agentclientprotocol/sdk";
import {
  createAcpSession,
  getAcpSession,
  touchAcpSession,
  cancelAcpSession,
  deleteAcpSession,
  listAcpSessions,
  type AcpSession,
} from "./sessions";
import { acpPromptToUIMessage, acpPromptToText, extractUiText } from "./content";
import { createAcpBridge } from "./bridge";
import { createAcpTools, type AcpClientLike } from "./tools";
import { isAbsolute, resolve } from "node:path";

export const QUBE_ACP_AGENT_NAME = "qube";
export const QUBE_ACP_AGENT_VERSION = "0.0.38";

type AnyRecord = Record<string, unknown>;

export type AcpPromptRunner = (args: {
  session: AcpSession;
  uiMessages: AnyRecord[];
  notify: (update: AnyRecord) => Promise<void>;
  signal: AbortSignal;
  client: AcpClientLike;
}) => Promise<{ cancelled: boolean; toolCallCount: number }>;

function toAcpMcpConfig(s: AnyRecord): { id: string; name: string; command: string; args: string[]; env: Record<string, string> } | null {
  try {
    // ACP stdio shape: { type?, command, args, env } — be lenient on field names.
    const command = (s.command as string) || (s.cmd as string);
    if (!command || typeof command !== "string") return null;
    const args = Array.isArray(s.args) ? (s.args as string[]) : [];
    let env: Record<string, string> = {};
    if (Array.isArray(s.env)) {
      for (const e of s.env as Array<{ name?: string; value?: string }>) {
        if (e?.name) env[e.name] = e.value ?? "";
      }
    } else if (s.env && typeof s.env === "object") {
      env = s.env as Record<string, string>;
    }
    const name = (s.name as string) || command;
    return { id: `acp_${name}`, name, command, args, env };
  } catch {
    return null;
  }
}

export const defaultAcpPromptRunner: AcpPromptRunner = async ({
  session,
  uiMessages,
  notify,
  signal,
  client,
}) => {
  const { streamText, convertToModelMessages } = await import("ai");
  const { providerStore } = await import("@/lib/pi/provider-store");
  const { createPiModelClient } = await import("@/lib/pi/model-client");
  const { buildPiSystemPrompt } = await import("@/lib/pi/system-prompt");
  const { loadMcpTools, closeMcpClients } = await import("@/lib/pi/mcp");

  const bridge = createAcpBridge(session.sessionId, notify);
  const writer = { write: (c: unknown) => bridge.write(c as AnyRecord) };

  // Model: explicit session model, then QUBE_MODEL env (see stdio.ts), then app default.
  const modelId = session.modelName || process.env.QUBE_MODEL || providerStore.getDefaultModelId() || "";
  if (!modelId) throw new Error("No model configured (Settings → Model, or QUBE_MODEL env).");
  const model = createPiModelClient(modelId);

  // System prompt (skills off in ACP stdio mode to keep it lean; memory off)
  const systemPrompt = buildPiSystemPrompt({ skills: [], connectors: [] });

  // Tools: session-scoped, read-only when mode=ask
  const acpTools = createAcpTools(session, {
    readOnly: session.mode === "ask",
    client,
    sessionId: session.sessionId,
  });
  let tools: Record<string, unknown> = { ...acpTools };
  let mcpClients: Awaited<ReturnType<typeof loadMcpTools>>["clients"] = [];
  try {
    const stdioServers = (session.mcpServers || []).map(toAcpMcpConfig).filter(Boolean) as Array<{
      id: string; name: string; command: string; args: string[]; env: Record<string, string>;
    }>;
    if (stdioServers.length > 0) {
      const res = await loadMcpTools({ threadId: session.threadId, servers: stdioServers });
      tools = { ...tools, ...res.tools };
      mcpClients = res.clients;
      if (res.errors.length > 0) {
        await writer.write({
          type: "text-start", id: `acp-mcp-warn-${Date.now()}`,
        } as AnyRecord);
        await writer.write({
          type: "text-delta",
          id: `acp-mcp-warn-${Date.now()}`,
          delta: `Warning: ${res.errors.length} MCP server(s) failed: ${res.errors.map((e) => e.name).join(", ")}`,
        } as AnyRecord);
        await writer.write({ type: "text-end", id: `acp-mcp-warn-${Date.now()}` } as AnyRecord);
      }
    }
  } catch {}

  const closeMcp = async () => {
    if (mcpClients.length > 0) {
      try {
        await closeMcpClients(mcpClients);
      } catch {}
    }
  };
  signal.addEventListener?.("abort", () => { void closeMcp(); }, { once: true });

  let modelMessages: unknown;
  try {
    modelMessages = await convertToModelMessages(uiMessages as never);
  } catch {
    modelMessages = uiMessages;
  }

  if (signal.aborted) return { cancelled: true, toolCallCount: 0 };

  const result = streamText({
    model: model as never,
    system: systemPrompt,
    messages: modelMessages as never,
    maxRetries: 0,
    abortSignal: signal,
    stopWhen: async ({ steps }: { steps: unknown[] }) => steps.length >= 15,
    temperature: 0.7,
    tools: tools as never,
  });

  const uiStream = result.toUIMessageStream({ originalMessages: uiMessages as never }) as ReadableStream<AnyRecord>;
  const reader = uiStream.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      await bridge.write(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    await closeMcp();
  }

  return { cancelled: signal.aborted, toolCallCount: bridge.getToolCallCount() };
};

export type QubeAcpAppOptions = {
  name?: string;
  promptRunner?: AcpPromptRunner;
  defaultModel?: string;
};

function resolveCwd(cwd: unknown): string {
  if (typeof cwd !== "string" || !cwd) throw new Error("session/new: cwd must be an absolute path");
  const r = resolve(cwd);
  if (!isAbsolute(r)) throw new Error("session/new: cwd must be absolute");
  return r;
}

export function createQubeAcpApp(opts?: QubeAcpAppOptions) {
  const promptRunner = opts?.promptRunner || defaultAcpPromptRunner;
  if (opts?.defaultModel) {
    try {
      process.env.QUBE_MODEL = opts.defaultModel;
    } catch {}
  }

  const app = acp.agent({ name: opts?.name || QUBE_ACP_AGENT_NAME });

  app.onRequest("initialize", async (ctx) => {
    const req = ctx.params as AnyRecord;
    const clientVersion = (req.protocolVersion as number) ?? 1;
    return {
      protocolVersion: Math.min(clientVersion, acp.PROTOCOL_VERSION),
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: { list: {}, delete: {}, additionalDirectories: {} },
      },
      agentInfo: { name: QUBE_ACP_AGENT_NAME, version: QUBE_ACP_AGENT_VERSION },
    };
  });

  app.onRequest("authenticate", async () => ({}));

  app.onRequest("session/new", async (ctx) => {
    const req = ctx.params as AnyRecord;
    const cwd = resolveCwd(req.cwd);
    const additionalDirectories = Array.isArray(req.additionalDirectories)
      ? (req.additionalDirectories as string[])
      : [];
    const mcpServers = Array.isArray(req.mcpServers) ? (req.mcpServers as AnyRecord[]) : [];
    const nonStdio = mcpServers.filter((s) => (s.type as string) && (s.type as string) !== "stdio");
    const session = createAcpSession({ cwd, additionalDirectories, mcpServers });
    try {
      const { saveSession } = await import("@/lib/memory/session-store");
      const title = `ACP ${cwd.split("/").pop() || cwd}`;
      await saveSession(session.threadId, title, "", `cwd: ${cwd}`, true).catch(() => {});
    } catch {}
    void nonStdio;
    return {
      sessionId: session.sessionId,
      modes: {
        currentModeId: session.mode,
        availableModes: [
          { id: "build", name: "Build", description: "Full tools: read, edit, run commands" },
          { id: "ask", name: "Ask", description: "Read-only: no writes or commands" },
        ],
      },
    };
  });

  app.onRequest("session/load", async (ctx) => {
    const req = ctx.params as AnyRecord;
    const sessionId = req.sessionId as string;
    const modes = {
      currentModeId: "build",
      availableModes: [
        { id: "build", name: "Build", description: "Full tools: read, edit, run commands" },
        { id: "ask", name: "Ask", description: "Read-only: no writes or commands" },
      ],
    };
    const existing = getAcpSession(sessionId);
    if (existing) {
      const cwd = req.cwd ? resolveCwd(req.cwd) : existing.cwd;
      existing.cwd = cwd;
      if (Array.isArray(req.mcpServers)) existing.mcpServers = req.mcpServers as AnyRecord[];
      touchAcpSession(existing);
      return { modes };
    }
    // Rehydrate from persisted thread transcript when possible.
    try {
      const { readSession } = await import("@/lib/memory/session-store");
      const rec = await readSession(sessionId).catch(() => null);
      if (rec) {
        const cwd = req.cwd ? resolveCwd(req.cwd) : process.cwd();
        createAcpSession({
          cwd,
          mcpServers: Array.isArray(req.mcpServers) ? (req.mcpServers as AnyRecord[]) : [],
          sessionId,
        });
        return { modes };
      }
    } catch {}
    throw new Error(`Session ${sessionId} not found`);
  });

  app.onRequest("session/list", async (ctx) => {
    const req = (ctx.params as AnyRecord) || {};
    const cwd = typeof req.cwd === "string" ? req.cwd : undefined;
    const sessions = listAcpSessions(cwd);
    return {
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        additionalDirectories: s.additionalDirectories,
        title: `ACP ${s.cwd.split("/").pop() || s.cwd}`,
        updatedAt: new Date(s.updatedAt).toISOString(),
      })),
    };
  });

  app.onRequest("session/delete", async (ctx) => {
    const req = ctx.params as AnyRecord;
    const sessionId = req.sessionId as string;
    if (!getAcpSession(sessionId)) throw new Error(`Session ${sessionId} not found`);
    deleteAcpSession(sessionId);
    return {};
  });

  app.onRequest("session/set_mode", async (ctx) => {
    const req = ctx.params as AnyRecord;
    const session = getAcpSession(req.sessionId as string);
    if (!session) throw new Error(`Session ${req.sessionId} not found`);
    const modeId = req.modeId as string;
    if (modeId !== "build" && modeId !== "ask") throw new Error(`Unknown mode "${modeId}" (available: build, ask)`);
    session.mode = modeId;
    touchAcpSession(session);
    return {};
  });

  app.onRequest("session/prompt", async (ctx) => {
    const req = ctx.params as unknown as { sessionId: string; prompt: AnyRecord[] };
    const session = getAcpSession(req.sessionId);
    if (!session) throw new Error(`Session ${req.sessionId} not found`);

    // Cancel any in-flight turn on this session (spec: new prompt supersedes).
    if (session.abortController) {
      try { session.abortController.abort(new Error("Superseded by new prompt")); } catch {}
    }
    const aborter = new AbortController();
    const onClientAbort = () => {
      try { aborter.abort(new Error("Request aborted")); } catch {}
    };
    ctx.signal.addEventListener?.("abort", onClientAbort, { once: true });
    session.abortController = aborter;

    const { message, warnings } = acpPromptToUIMessage(req.prompt || []);
    session.messages.push(message);
    touchAcpSession(session);

    const notify = async (update: AnyRecord) => {
      await ctx.client.notify("session/update", { sessionId: session.sessionId, update } as never);
    };

    for (const w of warnings) {
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `\n\n> Note: ${w}\n` } });
    }

    const acpClient: AcpClientLike = {
      requestPermission: async (toolCall, _options) => {
        try {
          const resp = await ctx.client.request("session/request_permission", {
            sessionId: session.sessionId,
            toolCall: toolCall as never,
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          } as never);
          const outcome = (resp as AnyRecord)?.outcome as AnyRecord | undefined;
          if (outcome?.outcome === "cancelled") return { approved: false };
          return { approved: (outcome as AnyRecord)?.optionId === "allow" };
        } catch {
          return { approved: true };
        }
      },
    };

    try {
      const uiMessages = session.messages;
      const { cancelled } = await promptRunner({
        session,
        uiMessages,
        notify,
        signal: aborter.signal,
        client: acpClient,
      });
      if (cancelled || aborter.signal.aborted) {
        return { stopReason: "cancelled" as const };
      }
      // Persist transcript (best-effort) + track thread.
      try {
        const { saveSession } = await import("@/lib/memory/session-store");
        const { setLastThreadId } = await import("@/lib/memory/session-tracker");
        const transcript = uiMessages.map((m) => `${(m as AnyRecord).role}: ${extractUiText(m as AnyRecord)}`).join("\n");
        const firstUser = uiMessages.find((m) => (m as AnyRecord).role === "user") as AnyRecord | undefined;
        const title = firstUser ? extractUiText(firstUser).slice(0, 80) || "ACP session" : "ACP session";
        await saveSession(session.threadId, title, "", transcript, true).catch(() => {});
        await setLastThreadId(session.threadId).catch(() => {});
      } catch {}
      const promptText = acpPromptToText((req.prompt || []) as AnyRecord[]);
      void promptText;
      return { stopReason: "end_turn" as const };
    } catch (e: unknown) {
      if (aborter.signal.aborted) return { stopReason: "cancelled" as const };
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `\n\n> Error: ${msg.slice(0, 2000)}\n` } });
      } catch {}
      throw e;
    } finally {
      try { ctx.signal.removeEventListener?.("abort", onClientAbort); } catch {}
      if (session.abortController === aborter) session.abortController = null;
      touchAcpSession(session);
    }
  });

  app.onNotification("session/cancel", async (ctx) => {
    const req = ctx.params as { sessionId: string };
    cancelAcpSession(req.sessionId);
  });

  return app;
}

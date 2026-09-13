/**
 * ACP session registry for Qube.
 *
 * Maps ACP sessionId -> thread state (threadId for Pi harness, cwd, history).
 * History is kept as UIMessage-compatible objects so the Pi harness
 * (streamText -> UIMessageStream) can consume it directly.
 */

export type AcpSessionMode = "build" | "ask";

export type AcpSession = {
  sessionId: string;
  threadId: string;
  cwd: string;
  additionalDirectories: string[];
  mode: AcpSessionMode;
  modelName?: string;
  mcpServers: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
  abortController: AbortController | null;
};

const sessions = new Map<string, AcpSession>();

export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `acp_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function newThreadId(): string {
  return `pi_thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createAcpSession(opts: {
  cwd: string;
  additionalDirectories?: string[];
  mcpServers?: Array<Record<string, unknown>>;
  modelName?: string;
  sessionId?: string;
}): AcpSession {
  const sessionId = opts.sessionId || newSessionId();
  const session: AcpSession = {
    sessionId,
    threadId: newThreadId(),
    cwd: opts.cwd,
    additionalDirectories: opts.additionalDirectories || [],
    mode: "build",
    modelName: opts.modelName,
    mcpServers: opts.mcpServers || [],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    abortController: null,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getAcpSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

export function touchAcpSession(session: AcpSession): void {
  session.updatedAt = Date.now();
}

export function deleteAcpSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (s?.abortController) {
    try {
      s.abortController.abort(new Error("Session deleted"));
    } catch {}
  }
  return sessions.delete(sessionId);
}

export function listAcpSessions(cwd?: string): AcpSession[] {
  const all = Array.from(sessions.values());
  const filtered = cwd ? all.filter((s) => s.cwd === cwd) : all;
  return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function setSessionAbort(session: AcpSession, c: AbortController | null): void {
  session.abortController = c;
}

export function cancelAcpSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  // Abort the ACP-level controller (wired into streamText).
  if (s.abortController) {
    try {
      s.abortController.abort(new Error("Cancelled by client (session/cancel)"));
    } catch {}
  }
  // Also abort the Pi harness run keyed by threadId (same process).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cancelPiRun } = require("@/lib/pi/harness") as typeof import("@/lib/pi/harness");
    cancelPiRun(s.threadId);
  } catch {}
  return true;
}

/** Test helper — clears in-memory registry. */
export function __clearAcpSessions(): void {
  sessions.clear();
}

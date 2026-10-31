"use client";

import { AssistantRuntimeProvider, useRemoteThreadListRuntime } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useQubeThreadListAdapter } from "@/lib/chat/thread-list-adapter";
import { getOrCreateInstanceId } from "@/lib/connectors/connectors-cache";
import { useAssistantToolUI } from "@assistant-ui/react";
import {
  WebSearchToolUI,
  WebFetchToolUI,
  ReadFileToolUI,
  WriteFileToolUI,
  EditFileToolUI,
  DeleteFileToolUI,
  ListDirectoryToolUI,
  RunCommandToolUI,
  ListSessionsToolUI,
  ReadSessionSummaryToolUI,
  ReadSessionToolUI,
  ReadMemoryToolUI,
  AskUserToolUI,
  ScheduleTaskToolUI,
  UpdateHeartbeatToolUI,
  GoalToolUI,
  GenerativeUIToolUI,
  ShowFileToolUI,
} from "@/components/assistant-ui/tools";
import { ConnectorToolUI, ConnectServiceToolUI, CompactionNoticeDataUI } from "@/components/assistant-ui/tools";
import { useChatGPTProviderSync } from "@/components/chatgpt/chatgpt-provider-sync";
import { type ReactNode, useEffect, useState } from "react";

/**
 * Keeps the ChatGPT provider's model list in sync with the signed-in account
 * on app start. The Codex catalog is plan- and version-gated, so a cached
 * model can disappear between sessions; this refreshes it without requiring
 * the user to open Settings first.
 */
function ChatGPTProviderSync() {
  useChatGPTProviderSync();
  return null;
}

function ToolUIRegistrar() {
  // Pi harness tools — file, shell, web (Pi emits tool calls as tool-input-available / tool-output-available)
  useAssistantToolUI({ toolName: "web_search", render: WebSearchToolUI });
  useAssistantToolUI({ toolName: "web_fetch", render: WebFetchToolUI });
  useAssistantToolUI({ toolName: "read_file", render: ReadFileToolUI });
  useAssistantToolUI({ toolName: "write_file", render: WriteFileToolUI });
  useAssistantToolUI({ toolName: "edit_file", render: EditFileToolUI });
  useAssistantToolUI({ toolName: "delete_file", render: DeleteFileToolUI });
  useAssistantToolUI({ toolName: "list_directory", render: ListDirectoryToolUI });
  useAssistantToolUI({ toolName: "run_command", render: RunCommandToolUI });
  useAssistantToolUI({ toolName: "read_scratchpad", render: ReadFileToolUI });
  useAssistantToolUI({ toolName: "write_scratchpad", render: WriteFileToolUI });
  useAssistantToolUI({ toolName: "append_scratchpad", render: WriteFileToolUI });
  useAssistantToolUI({ toolName: "present_file", render: ShowFileToolUI });
  useAssistantToolUI({ toolName: "ask_question", render: AskUserToolUI });
  useAssistantToolUI({ toolName: "ask_user", render: AskUserToolUI });
  useAssistantToolUI({ toolName: "ask_user", render: AskUserToolUI });
  // Pi automation tools — schedules, heartbeat
  useAssistantToolUI({ toolName: "schedule_task", render: ScheduleTaskToolUI });
  useAssistantToolUI({ toolName: "update_heartbeat", render: UpdateHeartbeatToolUI });
  // Qube Computer tools — the shared ToolRow card renders their results;
  // the persistent session itself is shown in the Qube Computer panel.
  // Legacy Codex native events kept for forward compat (if old sessions contain them)
  useAssistantToolUI({ toolName: "command_execution", render: RunCommandToolUI });
  useAssistantToolUI({ toolName: "file_change", render: WriteFileToolUI });
  useAssistantToolUI({ toolName: "mcp_tool_call", render: ConnectorToolUI });

  // Keep lightweight session connectors for history
  useAssistantToolUI({ toolName: "list_sessions", render: ListSessionsToolUI });
  useAssistantToolUI({ toolName: "read_session_summary", render: ReadSessionSummaryToolUI });
  useAssistantToolUI({ toolName: "read_session", render: ReadSessionToolUI });
  useAssistantToolUI({ toolName: "read_memory", render: ReadMemoryToolUI });
  useAssistantToolUI({ toolName: "save_memory", render: ReadMemoryToolUI });
  useAssistantToolUI({ toolName: "connect_service", render: ConnectServiceToolUI });
  useAssistantToolUI({ toolName: "composio_search_tools", render: ConnectorToolUI });
  useAssistantToolUI({ toolName: "composio_multi_execute_tool", render: ConnectorToolUI });
  // Generative UI (OpenIntelligentUI pattern, Qube-styled sandbox)
  useAssistantToolUI({ toolName: "generate_ui", render: GenerativeUIToolUI });
  return null;
}


export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Startup waterfall fix (Windows): don't fire 5 fetches during first
    // paint. Providers sync stays immediate (needed for the model picker);
    // everything else is deferred until the browser is idle so WebView2 can
    // paint the chat first.
    const idle = (fn: () => void, ms = 1200) => {
      try {
        const ric = (window as any).requestIdleCallback;
        if (typeof ric === "function") {
          ric(fn, { timeout: ms + 800 });
          return;
        }
      } catch {}
      setTimeout(fn, ms);
    };
    idle(() => {
      // Pi harness setup (MCP enabled)
      fetch("/api/setup", { method: "POST" }).catch(() => {});
      // Hydrate skills cache so the first chat already carries system skills
      fetch("/api/skills/sync")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.skills) && data.skills.length > 0) {
            try {
              localStorage.setItem("qube-skills", JSON.stringify(data.skills));
            } catch {}
          }
        })
        .catch(() => {});
      // Hydrate allowed-directories cache for the chat pipeline
      fetch("/api/permissions/dirs")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.dirs)) {
            try {
              localStorage.setItem("qube-allowed-directories", JSON.stringify(data.dirs));
            } catch {}
          }
        })
        .catch(() => {});
    }, 1200);
    if (typeof window !== "undefined") {
      // Single shared per-install identity (synchronous, self-creating).
      // Never the global default — it collides across machines sharing the
      // built-in Composio key and shows other installs' connections.
      try {
        getOrCreateInstanceId();
      } catch {
        try {
          const existing = localStorage.getItem("qube-instance-id");
          if (!existing || existing === "qube-default-user") {
            localStorage.setItem("qube-instance-id", crypto.randomUUID());
          }
        } catch {}
      }

      const stored = localStorage.getItem("qube-providers");
      if (stored) {
        try {
          const providers = JSON.parse(stored);
          const defaultModelId = localStorage.getItem("qube-default-model") || null;
          fetch("/api/providers/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providers, defaultModelId }),
          }).catch((e) => console.error("[AgentRuntimeProvider] Auto-sync failed:", e));
        } catch (e) {
          console.error("[AgentRuntimeProvider] Auto-sync parse failed:", e);
        }
      }

      // Hydrate localStorage from server-side settings on cold start — also
      // deferred so it never competes with first paint on Windows.
      idle(() => {
        const needsHydrate = !localStorage.getItem("qube-custom-system-prompt") &&
          !localStorage.getItem("qube-user-name");
        if (needsHydrate) {
          fetch("/api/settings")
            .then((r) => r.json())
            .then((data) => {
              const s = data.settings;
              if (!s) return;
              if (s.customSystemPrompt) localStorage.setItem("qube-custom-system-prompt", s.customSystemPrompt);
              if (s.temperature !== undefined) localStorage.setItem("qube-temperature", String(s.temperature));
              if (s.userName) localStorage.setItem("qube-user-name", s.userName);
              if (s.userAbout) localStorage.setItem("qube-user-about", s.userAbout);
              if (s.defaultModel) localStorage.setItem("qube-default-model", s.defaultModel);
              if (s.runOnStart !== undefined) localStorage.setItem("qube-run-on-start", String(s.runOnStart));
              if (s.keepAlive !== undefined) localStorage.setItem("qube-keep-alive", String(s.keepAlive));
              if (s.memoryEnabled !== undefined) localStorage.setItem("qube-memory-enabled", String(s.memoryEnabled !== false));
              if (s.runOnStart) {
                fetch("/api/scheduler/tasks").catch(() => {});
              }
            })
            .catch(() => {});
        } else {
          const runOnStart = localStorage.getItem("qube-run-on-start");
          if (runOnStart === "true") {
            fetch("/api/scheduler/tasks").catch(() => {});
          }
        }
      }, 1800);
    }
  }, []);

  const adapter = useQubeThreadListAdapter();

  // Deep-link support: start on the chat from the URL when present.
  const [initialThreadId] = useState<string | undefined>(() => {
    try {
      if (typeof window === "undefined") return undefined;
      const m = window.location.pathname.match(/^\/chat\/(.+?)\/?$/);
      return m ? decodeURIComponent(m[1]) : undefined;
    } catch {
      return undefined;
    }
  });

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useQubeChatThread,
    adapter,
    ...(initialThreadId ? { threadId: initialThreadId } : {}),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatGPTProviderSync />
      <ToolUIRegistrar />
      <CompactionNoticeDataUI />
      {children}
    </AssistantRuntimeProvider>
  );
}

// Per-thread chat runtime. Nested inside the outer remote thread list
// (allowNesting), so each chat keeps its own live useChat: switching chats
// never aborts a running one.
function useQubeChatThread() {
  return useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
      // body as a function: re-evaluated on every request so settings changes
      // made in the Settings dialog are picked up immediately.
      body: () => {
        if (typeof window === "undefined") return {};
        const customSystemPrompt = localStorage.getItem("qube-custom-system-prompt") || undefined;
        const temperatureRaw = localStorage.getItem("qube-temperature");
        const temperature = temperatureRaw ? parseFloat(temperatureRaw) : undefined;
        const userName = localStorage.getItem("qube-user-name") || undefined;
        const userAbout = localStorage.getItem("qube-user-about") || undefined;

        const instanceId = (() => {
          try {
            return getOrCreateInstanceId() || undefined;
          } catch {
            return localStorage.getItem("qube-instance-id") || undefined;
          }
        })();
        let mcpServers: any[] | undefined;
        try {
          const raw = localStorage.getItem("qube-custom-mcp-servers");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) mcpServers = parsed;
          }
        } catch {}
        let skills: any[] | undefined;
        try {
          const raw = localStorage.getItem("qube-skills");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) skills = parsed;
          }
        } catch {}
        let allowedDirs: any[] | undefined;
        try {
          const raw = localStorage.getItem("qube-allowed-directories");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) allowedDirs = parsed;
          }
        } catch {}
        // Long-term memory toggle (Advanced settings). Default ON; only explicit "false" disables.
        let memoryEnabled: boolean | undefined;
        try {
          const raw = localStorage.getItem("qube-memory-enabled");
          if (raw !== null) memoryEnabled = raw === "true";
        } catch {}

        return {
          instanceId,
          ...(customSystemPrompt ? { customSystemPrompt } : {}),
          ...(temperature !== undefined && !isNaN(temperature) ? { temperature } : {}),
          ...(userName ? { userName } : {}),
          ...(userAbout ? { userAbout } : {}),
          ...(mcpServers ? { mcpServers } : {}),
          ...(skills ? { skills } : {}),
          ...(allowedDirs ? { allowedDirs } : {}),
          ...(memoryEnabled !== undefined ? { memoryEnabled } : {}),
        };
      },
    }),
  });
}

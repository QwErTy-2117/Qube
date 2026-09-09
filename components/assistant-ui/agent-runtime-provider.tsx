"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
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
  ShowFileToolUI,
} from "@/components/assistant-ui/tools";
import { ConnectorToolUI, ConnectServiceToolUI } from "@/components/assistant-ui/tools";
import { BrowserToolUI } from "@/components/workspace";
import { type ReactNode, useEffect } from "react";

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
  useAssistantToolUI({ toolName: "present_file", render: ShowFileToolUI });
  useAssistantToolUI({ toolName: "ask_question", render: AskUserToolUI });
  useAssistantToolUI({ toolName: "ask_user", render: AskUserToolUI });
  useAssistantToolUI({ toolName: "ask_user", render: AskUserToolUI });
  // Pi automation tools — schedules, heartbeat
  useAssistantToolUI({ toolName: "schedule_task", render: ScheduleTaskToolUI });
  useAssistantToolUI({ toolName: "update_heartbeat", render: UpdateHeartbeatToolUI });
  // Browser Use MCP tools (live browser; panel renders the real page)
  useAssistantToolUI({ toolName: "browser_navigate", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_navigate_back", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_navigate_forward", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_search", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_read", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_snapshot", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_screenshot", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_click", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_hover", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_drag", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_type", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_find", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_fill", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_fill_form", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_press_key", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_select_option", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_file_upload", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_handle_dialog", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_back", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_wait_for", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_evaluate", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_console_messages", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_network_requests", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_tabs", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_close", render: BrowserToolUI });
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

  return null;
}


function PrefetchManager() {
  // VoiceMem-style speculative prefetch: while user still typing, start memory search at 6 chars so full query is 0-300ms when they hit send
  useEffect(() => {
    let lastPrefetch = "";
    let timer: any = null;
    const handler = () => {
      try {
        // Skip speculative memory prefetch when long-term memory is disabled.
        try {
          if (localStorage.getItem("qube-memory-enabled") === "false") return;
        } catch {}
        // Find composer input — assistant-ui stores it in runtime, but we can also query DOM
        const composer = document.querySelector('[data-composer-input]') as HTMLTextAreaElement | HTMLInputElement | null;
        const text = composer?.value?.trim() || "";
        if (text.length < 6) return;
        if (text === lastPrefetch) return;
        if (text.length < lastPrefetch.length && !text.startsWith(lastPrefetch.slice(0, 6))) {
          // user cleared or changed topic, still prefetch
        }
        lastPrefetch = text;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          fetch("/api/memory/prefetch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partial: text }),
          }).catch(()=>{});
        }, 80); // debounce 80ms like VoiceMem gamble
      } catch {}
    };
    // Poll for composer changes (assistant-ui doesn't expose composer observable easily)
    const interval = setInterval(handler, 250);
    // Also listen to input events
    document.addEventListener("input", handler, true);
    return () => {
      clearInterval(interval);
      document.removeEventListener("input", handler, true);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
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
    if (typeof window !== "undefined") {
      let instanceId = localStorage.getItem("qube-instance-id");
      if (!instanceId) {
        instanceId = crypto.randomUUID();
        localStorage.setItem("qube-instance-id", instanceId);
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

      // Hydrate localStorage from server-side settings on cold start
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
    }
  }, []);

  const runtime = useChatRuntime({
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

        const instanceId = localStorage.getItem("qube-instance-id") || undefined;
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

        let qubeThreadId: string | undefined;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useThreadStore } = require("@/lib/chat/thread-store") as typeof import("@/lib/chat/thread-store");
          const st = useThreadStore.getState();
          qubeThreadId = st.selectedId || st.pendingId || undefined;
        } catch {}

        return {
          instanceId,
          ...(qubeThreadId ? { qubeThreadId } : {}),
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

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolUIRegistrar />
      <PrefetchManager />
      {children}
    </AssistantRuntimeProvider>
  );
}

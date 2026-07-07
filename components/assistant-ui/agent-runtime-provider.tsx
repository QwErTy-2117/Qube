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
  BrowserNavigateToolUI,
  BrowserScreenshotToolUI,
  BrowserToolUI,
  ScheduleTaskToolUI,
  UpdateHeartbeatToolUI,
} from "@/components/assistant-ui/tools";
import type { ReactNode } from "react";

function ToolUIRegistrar() {
  useAssistantToolUI({ toolName: "web_search", render: WebSearchToolUI });
  useAssistantToolUI({ toolName: "web_fetch", render: WebFetchToolUI });
  useAssistantToolUI({ toolName: "read_file", render: ReadFileToolUI });
  useAssistantToolUI({ toolName: "write_file", render: WriteFileToolUI });
  useAssistantToolUI({ toolName: "edit_file", render: EditFileToolUI });
  useAssistantToolUI({ toolName: "delete_file", render: DeleteFileToolUI });
  useAssistantToolUI({ toolName: "list_directory", render: ListDirectoryToolUI });
  useAssistantToolUI({ toolName: "run_command", render: RunCommandToolUI });
  useAssistantToolUI({ toolName: "list_sessions", render: ListSessionsToolUI });
  useAssistantToolUI({ toolName: "read_session_summary", render: ReadSessionSummaryToolUI });
  useAssistantToolUI({ toolName: "read_session", render: ReadSessionToolUI });
  useAssistantToolUI({ toolName: "read_memory", render: ReadMemoryToolUI });
  useAssistantToolUI({ toolName: "ask_user", render: AskUserToolUI });
  useAssistantToolUI({ toolName: "schedule_task", render: ScheduleTaskToolUI });
  useAssistantToolUI({ toolName: "update_heartbeat", render: UpdateHeartbeatToolUI });

  useAssistantToolUI({ toolName: "browser_navigate", render: BrowserNavigateToolUI });
  useAssistantToolUI({ toolName: "browser_take_screenshot", render: BrowserScreenshotToolUI });
  useAssistantToolUI({ toolName: "browser_snapshot", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_click", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_type", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_fill_form", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_hover", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_press_key", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_select_option", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_file_upload", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_tabs", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_evaluate", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_console_messages", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_network_requests", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_scroll", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_save_profile", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_load_profile", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_list_profiles", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_navigate_back", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_reload", render: BrowserToolUI });
  useAssistantToolUI({ toolName: "browser_wait_for", render: BrowserToolUI });

  return null;
}


export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
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
        return {
          ...(customSystemPrompt ? { customSystemPrompt } : {}),
          ...(temperature !== undefined && !isNaN(temperature) ? { temperature } : {}),
          ...(userName ? { userName } : {}),
          ...(userAbout ? { userAbout } : {}),
        };
      },
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolUIRegistrar />
      {children}
    </AssistantRuntimeProvider>
  );
}

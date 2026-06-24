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
  CreateExcelToolUI,
  CreateDocxToolUI,
  CreatePptxToolUI,
  ListSessionsToolUI,
  ReadSessionSummaryToolUI,
  ReadSessionToolUI,
  ReadMemoryToolUI,
  AskUserToolUI,
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
  useAssistantToolUI({ toolName: "create_excel", render: CreateExcelToolUI });
  useAssistantToolUI({ toolName: "create_docx", render: CreateDocxToolUI });
  useAssistantToolUI({ toolName: "create_pptx", render: CreatePptxToolUI });
  useAssistantToolUI({ toolName: "list_sessions", render: ListSessionsToolUI });
  useAssistantToolUI({ toolName: "read_session_summary", render: ReadSessionSummaryToolUI });
  useAssistantToolUI({ toolName: "read_session", render: ReadSessionToolUI });
  useAssistantToolUI({ toolName: "read_memory", render: ReadMemoryToolUI });
  useAssistantToolUI({ toolName: "ask_user", render: AskUserToolUI });

  return null;
}

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: "/api/chat" }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolUIRegistrar />
      {children}
    </AssistantRuntimeProvider>
  );
}

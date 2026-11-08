"use client";

import React, { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { EchoRing } from "@/components/assistant-ui/echo-ring";
import { cn } from "@/lib/utils";
import { StaticMarkdown } from "@/components/assistant-ui/markdown-text";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";
import { ReadFileToolUI } from "@/components/assistant-ui/tools/read-file-tool-ui";
import { WriteFileToolUI } from "@/components/assistant-ui/tools/write-file-tool-ui";
import { EditFileToolUI } from "@/components/assistant-ui/tools/edit-file-tool-ui";
import { DeleteFileToolUI } from "@/components/assistant-ui/tools/delete-file-tool-ui";
import { ListDirectoryToolUI } from "@/components/assistant-ui/tools/list-directory-tool-ui";
import { RunCommandToolUI } from "@/components/assistant-ui/tools/run-command-tool-ui";
import { WebSearchToolUI } from "@/components/assistant-ui/tools/web-search-tool-ui";
import { WebFetchToolUI } from "@/components/assistant-ui/tools/web-fetch-tool-ui";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];

const AGENT_VERB: Record<string, string> = {
  Explore: "Exploring",
  researcher: "Researching",
  reviewer: "Reviewing",
  general: "Working",
};

// Step titles share the app-wide friendly tool names (never raw tool ids).
function getToolLabel(toolName: unknown, args: any): string {
  return friendlyToolLabel(toolName, args);
}

const TOOL_UI_MAP: Record<string, React.ComponentType<any>> = {
  read_file: ReadFileToolUI,
  read_external_file: ReadFileToolUI,
  write_file: WriteFileToolUI,
  edit_file: EditFileToolUI,
  delete_file: DeleteFileToolUI,
  list_directory: ListDirectoryToolUI,
  list_external_directory: ListDirectoryToolUI,
  run_command: RunCommandToolUI,
  web_search: WebSearchToolUI,
  web_fetch: WebFetchToolUI,
};

interface SubagentToolUIProps {
  toolCallId?: string;
  args?: {
    title?: string;
    description?: string;
    prompt?: string;
    agentType?: string;
    subagentType?: "coder" | "researcher" | "reviewer" | "architect" | "general" | string;
    task?: string;
    label?: string;
  };
  result?: {
    title?: string;
    description?: string;
    subagentType?: string;
    status?: "completed" | "failed" | "running";
    summary?: string;
    error?: string;
    task?: string;
    steps?: Array<{
      type: "thought" | "tool" | "text";
      content: string;
      toolName?: string;
      args?: any;
      result?: any;
    }>;
    usage?: { reads: number; searches: number; tools: number };
  } | string;
  isExecuting?: boolean;
}

function SubagentSteps({ steps, isExecuting }: { steps: any[]; isExecuting?: boolean }) {
  if (steps.length === 0) {
    if (!isExecuting) return null;
    return (
      <div className="flex items-center gap-2 py-2 text-muted-foreground italic">
        <Loader2Icon className="size-3.5 animate-spin text-foreground" />
        <span>Getting oriented…</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {steps.map((step: any, idx: number) => {
        if (step.type === "thought") {
          return (
            <ToolGroupRoot key={idx} variant="ghost" defaultOpen={false}>
              <ToolGroupTrigger count={1} active={false} label="Thinking" />
              <ToolGroupContent>
                <div className="px-3 py-2 text-xs italic leading-relaxed text-muted-foreground">
                  {typeof step.content === "string" ? step.content : String(step.content ?? "")}
                </div>
              </ToolGroupContent>
            </ToolGroupRoot>
          );
        }
        if (step.type === "tool") {
          const toolName: string = typeof step.toolName === "string" ? step.toolName : "tool";
          const ToolComponent = TOOL_UI_MAP[toolName] || ToolFallback;
          const isDestructive = DESTRUCTIVE_KEYWORDS.some((kw) =>
            toolName.toLowerCase().includes(kw)
          );
          const label = getToolLabel(toolName, step.args);
          let normalizedResult: any = step.result;
          if (normalizedResult != null && typeof normalizedResult !== "string") {
            try {
              normalizedResult = JSON.stringify(normalizedResult);
            } catch {
              try {
                normalizedResult = String(normalizedResult);
              } catch {
                normalizedResult = "[unserializable result]";
              }
            }
          }
          const argsForUI =
            step.args ??
            (() => {
              try {
                return JSON.parse(typeof step.content === "string" ? step.content : "{}");
              } catch {
                return { label: typeof step.content === "string" ? step.content : String(step.content ?? "") };
              }
            })();
          return (
            <ToolGroupRoot key={idx} variant="ghost" defaultOpen={isDestructive}>
              <ToolGroupTrigger count={1} active={false} label={label} />
              <ToolGroupContent>
                <ToolComponent
                  toolName={toolName}
                  args={argsForUI}
                  result={normalizedResult ?? step.result}
                  status={{ type: "complete" }}
                />
              </ToolGroupContent>
            </ToolGroupRoot>
          );
        }
        if (step.type === "text") {
          return (
            <div key={idx} className="prose dark:prose-invert max-w-none px-1 text-sm">
              <StaticMarkdown text={step.content} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export function SubagentToolUI({ args, result, isExecuting }: SubagentToolUIProps) {
  const [open, setOpen] = useState(false);

  let parsedResult: any = null;
  if (typeof result === "string") {
    try {
      parsedResult = JSON.parse(result);
    } catch {
      parsedResult = { summary: result };
    }
  } else {
    parsedResult = result;
  }

  // New backend shape: description + prompt + agentType; legacy: title + task + subagentType
  // Coerce everything to strings — model args can arrive as non-strings and
  // must never reach a .trim()/.replace() call as an object.
  const asStr = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : v == null ? fallback : String(v);
  const agentType: string =
    asStr((args as any)?.agentType) ||
    asStr((args as any)?.subagentType) ||
    asStr(parsedResult?.subagentType) ||
    asStr(parsedResult?.title) ||
    "general";
  const displayType = agentType === "general" ? "Explore" : agentType;
  const description =
    asStr(args?.description) || asStr(parsedResult?.description) || asStr(args?.label) || "Subagent task";
  const taskPrompt =
    asStr((args as any)?.prompt) || asStr((args as any)?.task) || asStr(parsedResult?.task);
  const summary = asStr(parsedResult?.summary);
  const error = asStr(parsedResult?.error);
  const isFailed = parsedResult?.status === "failed" || !!error;
  const steps = Array.isArray(parsedResult?.steps) ? parsedResult.steps : [];
  const usage = parsedResult?.usage as { reads: number; searches: number; tools: number } | undefined;

  const reads = usage?.reads ?? steps.filter((s: any) => s.type === "tool" && (s.toolName === "read_file" || s.toolName === "list_directory")).length;
  const searches = usage?.searches ?? steps.filter((s: any) => s.type === "tool" && (s.toolName === "web_search" || s.toolName === "web_fetch")).length;
  const verb = AGENT_VERB[agentType] || AGENT_VERB[displayType] || "Working";

  // The final response is often recorded twice: once as a `text` step in
  // the working transcript and again as `summary`. Only render the
  // summary block when it adds something new — never repeat the same
  // text a second time below the working section.
  const norm = (v: string) => v.replace(/\s+/g, " ").trim();
  const normSummary = norm(summary);
  const stepTexts = steps
    .filter((s: any) => s?.type === "text" && typeof s.content === "string")
    .map((s: any) => norm(s.content as string))
    .filter((t: string) => t.length > 0);
  const summaryDuplicated =
    normSummary.length > 0 &&
    stepTexts.some((t: string) => t === normSummary || t.includes(normSummary));

  return (
    <>
      {/* Pill in main chat — small component showing the subagent is working */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-slot="aui_subagent-pill"
        className="my-2 flex w-fit max-w-full items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted"
      >
        <span className="flex shrink-0 items-center">
          <EchoRing tone={isExecuting ? "working" : isFailed ? "error" : "done"} size={16} />
        </span>
        <span className="flex min-w-0 items-baseline gap-3 text-sm">
          <span className="shrink-0 font-medium tracking-[-0.01em] text-foreground/90">{displayType}</span>
          <span className="truncate text-muted-foreground">{description}</span>
        </span>
      </button>

      {/* Popup with the subagent working — same UI components as the main agent */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl border border-border bg-background p-0 shadow-2xl sm:max-w-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-background px-5 py-3">
            <DialogTitle className="flex min-w-0 items-center gap-3 text-sm font-semibold">
              <span className="flex shrink-0 items-center">
                <EchoRing tone={isExecuting ? "working" : isFailed ? "error" : "done"} size={18} />
              </span>
              <span className="flex min-w-0 items-baseline gap-3 truncate">
                <span className="shrink-0">{displayType}</span>
                <span className="truncate font-normal text-muted-foreground">{description}</span>
              </span>
            </DialogTitle>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-background px-5 py-4">
            {/* Original prompt bubble */}
            {taskPrompt && (
              <div className="rounded-xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
                {taskPrompt}
              </div>
            )}

            {/* Live status line like "Exploring  24 reads, 5 searches" */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isExecuting && <Loader2Icon className="size-3.5 animate-spin" />}
              <span>
                {verb}
                {(reads > 0 || searches > 0) && (
                  <>
                    {"  "}
                    {reads > 0 && `${reads} read${reads === 1 ? "" : "s"}`}
                    {reads > 0 && searches > 0 && ", "}
                    {searches > 0 && `${searches} search${searches === 1 ? "" : "es"}`}
                  </>
                )}
              </span>
            </div>

            {/* Transcript with the same components as the main agent */}
            <SubagentSteps steps={steps} isExecuting={isExecuting} />

            {isFailed && error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {summary && !summaryDuplicated && (
              <div
                className={cn(
                  steps.length > 0 ? "border-t border-border/20 pt-3" : "",
                  "prose dark:prose-invert max-w-none text-sm leading-relaxed"
                )}
              >
                <StaticMarkdown text={summary} />
              </div>
            )}
          </div>

          {/* Disabled composer footer */}
          <div className="border-t border-border/40 bg-background px-5 py-3">
            <div className="rounded-2xl bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
              Subagent sessions cannot be prompted.{" "}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
              >
                Back to main session.
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

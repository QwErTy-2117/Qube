"use client";

import React, { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { EchoRing } from "@/components/assistant-ui/echo-ring";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SyntaxHighlighter } from "@/components/assistant-ui/shiki-highlighter";
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

// Standalone markdown renderer for tool UI contexts (outside MessagePartText)
function StaticMarkdown({ text }: { text: unknown }) {
  const str = typeof text === "string" ? text : String(text ?? "");
  const clean = str.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ className, ...props }: any) => (
          <h1 className={cn("aui-md-h1 mb-4 mt-6 text-2xl font-bold", className)} {...props} />
        ),
        h2: ({ className, ...props }: any) => (
          <h2 className={cn("aui-md-h2 mb-3 mt-5 text-xl font-semibold", className)} {...props} />
        ),
        h3: ({ className, ...props }: any) => (
          <h3 className={cn("aui-md-h3 mb-2 mt-4 text-lg font-medium", className)} {...props} />
        ),
        p: ({ className, ...props }: any) => (
          <p className={cn("aui-md-p mb-4 leading-7", className)} {...props} />
        ),
        a: ({ className, ...props }: any) => (
          <a className={cn("aui-md-a text-primary underline underline-offset-2", className)} {...props} />
        ),
        blockquote: ({ className, ...props }: any) => (
          <blockquote className={cn("aui-md-blockquote border-l-4 border-primary/30 pl-4 italic text-muted-foreground", className)} {...props} />
        ),
        ul: ({ className, ...props }: any) => (
          <ul className={cn("aui-md-ul mb-4 list-disc pl-6", className)} {...props} />
        ),
        ol: ({ className, ...props }: any) => (
          <ol className={cn("aui-md-ol mb-4 list-decimal pl-6", className)} {...props} />
        ),
        li: ({ className, ...props }: any) => (
          <li className={cn("aui-md-li mb-1", className)} {...props} />
        ),
        hr: ({ className, ...props }: any) => (
          <hr className={cn("aui-md-hr my-6 border-border/50", className)} {...props} />
        ),
        table: ({ className, ...props }: any) => (
          <div className="mb-4 overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className={cn("aui-md-table w-full border-collapse text-sm", className)} {...props} />
            </div>
          </div>
        ),
        thead: ({ className, ...props }: any) => (
          <thead className={cn("aui-md-thead bg-muted/50", className)} {...props} />
        ),
        tbody: ({ className, ...props }: any) => (
          <tbody className={cn("aui-md-tbody", className)} {...props} />
        ),
        tr: ({ className, ...props }: any) => (
          <tr className={cn("aui-md-tr border-b border-border/50 last:border-b-0", className)} {...props} />
        ),
        th: ({ className, ...props }: any) => (
          <th className={cn("aui-md-th px-4 py-2 text-left font-medium", className)} {...props} />
        ),
        td: ({ className, ...props }: any) => (
          <td className={cn("aui-md-td px-4 py-2", className)} {...props} />
        ),
        pre: ({ className, children, ...props }: any) => (
          <pre className={cn("aui-md-pre mb-6", className)} {...props}>
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }: any) => {
          const codeString = String(children ?? "");
          const match = /language-(\w+)/.exec(className || "");
          const language = match?.[1];
          const isBlock = !!language || codeString.includes("\n");
          if (!isBlock) {
            return (
              <code
                className={cn("aui-md-inline-code rounded bg-muted px-1.5 py-0.5 text-sm font-mono", className)}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <SyntaxHighlighter language={language || "text"} code={codeString.replace(/\n$/, "")} />
          );
        },
      }}
    >
      {clean}
    </ReactMarkdown>
  );
}

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

  return (
    <>
      {/* Pill in main chat — small component showing the subagent is working */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-slot="aui_subagent-pill"
        className="my-1 flex w-fit max-w-full items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted"
      >
        <span className="flex shrink-0 items-center">
          <EchoRing tone={isExecuting ? "working" : isFailed ? "error" : "done"} size={16} />
        </span>
        <span className="flex min-w-0 items-baseline gap-3 text-sm">
          <span className="shrink-0 font-semibold text-foreground">{displayType}</span>
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

            {summary && (
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

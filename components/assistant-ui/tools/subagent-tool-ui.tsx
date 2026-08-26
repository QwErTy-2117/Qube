"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDownIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
} from "lucide-react";
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
import { ReadFileToolUI } from "@/components/assistant-ui/tools/read-file-tool-ui";
import { WriteFileToolUI } from "@/components/assistant-ui/tools/write-file-tool-ui";
import { EditFileToolUI } from "@/components/assistant-ui/tools/edit-file-tool-ui";
import { DeleteFileToolUI } from "@/components/assistant-ui/tools/delete-file-tool-ui";
import { ListDirectoryToolUI } from "@/components/assistant-ui/tools/list-directory-tool-ui";
import { RunCommandToolUI } from "@/components/assistant-ui/tools/run-command-tool-ui";
import { WebSearchToolUI } from "@/components/assistant-ui/tools/web-search-tool-ui";
import { WebFetchToolUI } from "@/components/assistant-ui/tools/web-fetch-tool-ui";

// Standalone markdown renderer for tool UI contexts (outside MessagePartText)
function StaticMarkdown({ text }: { text: string }) {
  const clean = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
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

const TOOL_GROUP_TITLES: Record<string, string> = {
  read_file: "Sneaking a peek",
  write_file: "Doodling something up",
  edit_file: "Tweaking things",
  delete_file: "Sending to the void",
  list_directory: "Nosing around",
  run_command: "Making magic happen",
  web_search: "Going down a rabbit hole",
  web_fetch: "Grabbing a page",
  list_sessions: "Checking the logbook",
  read_session_summary: "Skimming the past",
  read_session: "Reading the tea leaves",
  read_memory: "Scratching the brain",
  ask_user: "Poking the human",
  gmail: "Fiddling with your inbox",
  slack: "Slacking off",
  linear: "Organizing chaos",
  github: "Poking the repo",
  googlecalendar: "Rearranging your life",
  googledrive: "Digging through files",
  notion: "Notion-ing around",
  hubspot: "CRM-ing it up",
  asana: "Asana-ing tasks",
  trello: "Carding things",
  airtable: "Databasing casually",
  dropbox: "Dropping files",
  jira: "Ticketing around",
  composio: "Rooting around your apps",
};

const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];

function getToolLabel(toolName: string, args: any): string {
  const label = (args as any)?.label;
  if (label) return label;
  const title = TOOL_GROUP_TITLES[toolName];
  if (title) return title;
  const lower = toolName.toLowerCase();
  for (const [prefix, t] of Object.entries(TOOL_GROUP_TITLES)) {
    if (lower.startsWith(prefix)) return t;
  }
  return toolName;
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
    subagentType?: "coder" | "researcher" | "reviewer" | "architect" | "general";
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
  } | string;
  isExecuting?: boolean;
}

export function SubagentToolUI({ args, result, isExecuting }: SubagentToolUIProps) {
  const [expanded, setExpanded] = useState(false);

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

  const title = args?.title || parsedResult?.title || "Subagent Task";
  const description = args?.description || parsedResult?.description || "Executing task autonomously...";
  const summary = parsedResult?.summary || "";
  const error = parsedResult?.error || "";
  const isFailed = parsedResult?.status === "failed" || !!error;
  const steps = parsedResult?.steps || [];

  return (
    <div className="my-2.5 rounded-2xl border border-border/60 bg-muted/10 shadow-none overflow-hidden transition-all">
      {/* Compressed Rectangle Header */}
      <div
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold text-foreground truncate tracking-tight">
            {title}
          </h4>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {description}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground/70 transition-transform duration-200 shrink-0",
              expanded && "rotate-180"
            )}
          />
          {isExecuting ? (
            <Loader2Icon className="size-4 animate-spin text-foreground shrink-0" />
          ) : isFailed ? (
            <XIcon className="size-4 text-red-500 shrink-0" />
          ) : (
            <CheckIcon className="size-4 text-emerald-500 shrink-0" />
          )}
        </div>
      </div>

      {/* Expanded Details Panel: Inner UI identical to main agent (except outer subagent container) */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border/40 bg-background/50 px-4 py-3.5 text-xs space-y-3"
          >
            {/* Steps rendered with same components as main agent */}
            {steps.length > 0 ? (
              <div className="space-y-1">
                {steps.map((step: any, idx: number) => {
                  if (step.type === "thought") {
                    return (
                      <ToolGroupRoot key={idx} variant="ghost" defaultOpen={false}>
                        <ToolGroupTrigger count={1} active={false} label="Thinking" />
                        <ToolGroupContent>
                          <div className="px-3 py-2 text-xs text-muted-foreground italic leading-relaxed">
                            {step.content}
                          </div>
                        </ToolGroupContent>
                      </ToolGroupRoot>
                    );
                  }
                  if (step.type === "tool") {
                    const toolName: string = step.toolName || "tool";
                    const ToolComponent = TOOL_UI_MAP[toolName] || ToolFallback;
                    const isDestructive = DESTRUCTIVE_KEYWORDS.some(kw =>
                      toolName.toLowerCase().includes(kw)
                    );
                    const label = getToolLabel(toolName, step.args);
                    // Normalize result to string for ToolFallback compatibility
                    let normalizedResult: any = step.result;
                    if (normalizedResult != null && typeof normalizedResult !== "string") {
                      try {
                        normalizedResult = JSON.stringify(normalizedResult);
                      } catch {
                        normalizedResult = String(normalizedResult);
                      }
                    }
                    const argsForUI = step.args ?? (() => {
                      try {
                        return JSON.parse(step.content);
                      } catch {
                        return { label: step.content };
                      }
                    })();
                    return (
                      <ToolGroupRoot key={idx} variant="ghost" defaultOpen={isDestructive}>
                        <ToolGroupTrigger
                          count={1}
                          active={false}
                          label={label}
                        />
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
                      <div key={idx} className="prose dark:prose-invert text-xs max-w-none px-1">
                        <StaticMarkdown text={step.content} />
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ) : isExecuting ? (
              <div className="flex items-center gap-2 text-muted-foreground italic py-2">
                <Loader2Icon className="size-3.5 animate-spin text-foreground" />
                <span>Worker is analyzing context and carrying out steps...</span>
              </div>
            ) : null}

            {/* Error Output */}
            {isFailed && error && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs leading-relaxed">
                {error}
              </div>
            )}

            {/* Final summary — shown after steps (if any), no inner container/title, just markdown */}
            {summary && (
              <div className={cn(steps.length > 0 ? "pt-2 border-t border-border/20" : "", "text-xs leading-relaxed prose dark:prose-invert max-w-none")}>
                <StaticMarkdown text={summary} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

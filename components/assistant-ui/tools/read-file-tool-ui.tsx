"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileTextIcon } from "lucide-react";
import { SyntaxHighlighter } from "@/components/assistant-ui/shiki-highlighter";

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  php: "php",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  svelte: "html",
  vue: "html",
};

function inferLanguage(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_MAP[ext] : undefined;
}

export const ReadFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const filePath = (args as any)?.path || "";
  let data: { path?: string; content?: string; lineCount?: number } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || filePath;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <FileTextIcon className="size-4" />
        <span>Read File</span>
      </div>
      {displayPath && (
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {displayPath}
          </span>
          {data.lineCount !== undefined && (
            <span className="text-xs text-muted-foreground/60">
              ({data.lineCount} lines)
            </span>
          )}
        </div>
      )}
      {data.content && (
        <div className="max-h-96 overflow-auto rounded-md border border-border bg-background">
          <SyntaxHighlighter
            code={data.content}
            language={inferLanguage(displayPath) || "text"}
          />
        </div>
      )}
    </div>
  );
};

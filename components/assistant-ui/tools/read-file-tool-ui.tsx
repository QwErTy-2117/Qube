"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SyntaxHighlighter } from "@/components/assistant-ui/shiki-highlighter";
import { FileCard } from "./file-card";

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
  let data: { path?: string; relativePath?: string; content?: string; lineCount?: number } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || filePath;
  const downloadUrl = data.relativePath ? `/api/files/${data.relativePath}` : null;

  const ext = displayPath.split(".").pop()?.toLowerCase();
  const isDownloadable = ["pptx", "docx", "xlsx", "pdf", "csv", "zip", "png", "jpg", "jpeg", "gif", "svg"].includes(ext || "");

  const displayName = displayPath.split("/").pop() || displayPath;

  return (
    <div className="px-3 py-1 text-sm">
      {downloadUrl && isDownloadable && (
        <div className="mb-2">
          <FileCard filename={displayName} downloadUrl={downloadUrl} />
        </div>
      )}
      {displayPath && !(downloadUrl && isDownloadable) && (
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">
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

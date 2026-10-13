"use client";

import { memo, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Renderer, BuiltinActionType, type ActionEvent } from "@openuidev/react-lang";
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import { MarkdownText } from "./markdown-text";
import { SyntaxHighlighter } from "./shiki-highlighter";
import { containsOpenUI, splitBareRoot, splitOpenUISegments, toModelMessage } from "@/lib/openui/segments";
import { FILE_REF_RE } from "./md-file-ref";
import { renderLatexShortcuts } from "./latex-shortcuts";
import { cn } from "@/lib/utils";

export { containsOpenUI };

/**
 * Static Markdown for prose segments around OpenUI visuals.
 * Mirrors the aui-md styling used by MarkdownText/subagent StaticMarkdown,
 * but renders an explicit string (MessagePart-bound primitives can't).
 */
const SegmentMarkdown = memo(function SegmentMarkdown({ text }: { text: string }) {
  // Same preprocess as MarkdownText: strip scripts (safety), strip file-ref
  // markers (they render via PresentedFiles at the message bottom), then
  // LaTeX shortcuts — so mixed OpenUI replies keep identical prose semantics.
  FILE_REF_RE.lastIndex = 0;
  const clean = renderLatexShortcuts(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<script\b[^>]*\/>/gi, "")
      .replace(FILE_REF_RE, ""),
  );
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
});

/**
 * Hybrid assistant text.
 *
 * The OpenUI `<Renderer />` renders OpenUI Lang programs but drops
 * surrounding prose and renders nothing for plain Markdown (verified via
 * SSR). So messages carrying ```openui fences are split: prose segments
 * render as Markdown, fenced programs render via the Renderer. Plain
 * replies keep the existing context-bound <MarkdownText /> untouched.
 */
export function OpenUIText() {
  const text = useAuiState((s) => {
    try {
      const p = (s as unknown as { part?: { type?: string; text?: unknown } })?.part;
      if (!p || p.type !== "text") return null;
      return typeof p.text === "string" ? (p.text as string) : null;
    } catch {
      return null;
    }
  }) as string | null;

  const isRunning = useAuiState((s) => {
    try {
      const snap = s as unknown as {
        part?: { status?: { type?: string } };
        message?: { status?: { type?: string } };
      };
      const t = snap?.part?.status?.type ?? snap?.message?.status?.type;
      return t === "running";
    } catch {
      return false;
    }
  }) as boolean;

  let aui: ReturnType<typeof useAui> | null = null;
  try {
    aui = useAui();
  } catch {
    aui = null;
  }

  const onAction = useCallback(
    (event: ActionEvent) => {
      try {
        if (event.type === BuiltinActionType.ContinueConversation) {
          if (!aui) return;
          aui.thread().append({
            content: [{ type: "text", text: toModelMessage(event) }],
          } as never);
        } else if (event.type === BuiltinActionType.OpenUrl) {
          const url = String((event.params as Record<string, unknown> | undefined)?.url ?? "");
          if (/^https:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
        }
      } catch {}
    },
    [aui],
  );

  const segments = useMemo(() => {
    if (typeof text !== "string" || !containsOpenUI(text)) return null;
    // Bare program without fences (model skipped the fence): keep any
    // leading prose as text so the direct answer survives.
    if (!/```\s*openui(-lang)?\b/i.test(text)) return splitBareRoot(text);
    return splitOpenUISegments(text);
  }, [text]);

  if (typeof text !== "string") return <MarkdownText />;
  if (segments === null) return <MarkdownText />;

  return (
    <div className="aui-openui" data-slot="aui_openui-renderer">
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          if (!seg.content.trim()) return null;
          return (
            <div key={i} className="aui-md" data-slot="aui_openui-prose">
              <SegmentMarkdown text={seg.content} />
            </div>
          );
        }
        if (!seg.code.trim()) return null;
        return (
          <div key={i} className="aui-openui-visual my-2" data-slot="aui_openui-visual">
            <Renderer
              response={seg.code}
              library={openuiChatLibrary}
              isStreaming={!!isRunning}
              onAction={onAction}
            />
          </div>
        );
      })}
    </div>
  );
}

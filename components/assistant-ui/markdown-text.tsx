"use client";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  escapeCurrencyDollars,
  normalizeMathDelimiters,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  memo,
  useState,
  type FC,
  useCallback,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { SyntaxHighlighter } from "./shiki-highlighter";
import { TooltipIconButton } from "./tooltip-icon-button";
import { remarkFileRefs, MdFileCardNode, MdFileCardGroupNode, FILE_REF_RE } from "./md-file-ref";

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [isCopied, setIsCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (!code || isCopied) return;
    navigator.clipboard.writeText(code).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  }, [code, isCopied]);
  return (
    <div className="bg-muted/75 flex items-center justify-between rounded-t-lg border-b px-4 py-2 text-xs font-medium text-muted-foreground">
      <span>{language ?? "code"}</span>
      <TooltipIconButton tooltip="Copy code" onClick={onCopy}>
        {!isCopied && <CopyIcon className="size-3.5" />}
        {isCopied && <CheckIcon className="size-3.5" />}
      </TooltipIconButton>
    </div>
  );
};

// Raw text of a fenced block (children may be a string or string array).
function fenceText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children))
    return children.filter((c): c is string => typeof c === "string").join("");
  return "";
}

/**
 * Strip agent-only artifacts before markdown parsing:
 * - inline <script> blocks never belong in a rendered reply
 * - [file:]/present_file(...) markers render through PresentedFiles instead
 */
function stripAgentArtifacts(text: string): string {
  const clean = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "");
  FILE_REF_RE.lastIndex = 0;
  return clean.replace(FILE_REF_RE, "");
}

/**
 * Normalize model-produced math delimiters (\(...\), \[...\], custom tags)
 * into the $.../$$...$ form remark-math understands, then protect currency
 * amounts such as "$5" from being parsed as inline math.
 */
export function preprocessMarkdown(text: string): string {
  return escapeCurrencyDollars(normalizeMathDelimiters(stripAgentArtifacts(text)));
}

/**
 * The streaming reveal is handled by assistant-ui's smooth text animator:
 * characters are committed on a steady cadence, so prose grows as one
 * continuous stream instead of mounting word-sized blocks. Per-word spans are
 * deliberately not used here — they caused the visible chunking and re-wrapped
 * mid-animation. Finished messages render statically.
 */
// markdown (generative UI components, subagent steps).
function sharedComponents() {
  return {
    h1: ({ className, children, ...props }: any) => (
      <h1 className={cn("aui-md-h1 mb-4 mt-6 text-2xl font-bold", className)} {...props}>
        {children}
      </h1>
    ),
    h2: ({ className, children, ...props }: any) => (
      <h2 className={cn("aui-md-h2 mb-3 mt-5 text-xl font-semibold", className)} {...props}>
        {children}
      </h2>
    ),
    h3: ({ className, children, ...props }: any) => (
      <h3 className={cn("aui-md-h3 mb-2 mt-4 text-lg font-medium", className)} {...props}>
        {children}
      </h3>
    ),
    p: ({ className, children, ...props }: any) => (
      <p className={cn("aui-md-p mb-4 leading-7", className)} {...props}>
        {children}
      </p>
    ),
    a: ({ className, children, ...props }: any) => (
      <a className={cn("aui-md-a text-primary underline underline-offset-2", className)} {...props}>
        {children}
      </a>
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
    li: ({ className, children, ...props }: any) => (
      <li className={cn("aui-md-li mb-1", className)} {...props}>
        {children}
      </li>
    ),
    hr: ({ className, ...props }: any) => (
      <hr className={cn("aui-md-hr my-6 border-border/50", className)} {...props} />
    ),
    table: ({ className, ...props }: any) => (
      <div className="mb-4 mt-6 overflow-hidden rounded-lg border">
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
    th: ({ className, children, ...props }: any) => (
      <th className={cn("aui-md-th px-4 py-2 text-left font-medium", className)} {...props}>
        {children}
      </th>
    ),
    td: ({ className, children, ...props }: any) => (
      <td className={cn("aui-md-td px-4 py-2", className)} {...props}>
        {children}
      </td>
    ),
    pre: ({ className, ...props }: any) => (
      <pre className={cn("aui-md-pre mb-6", className)} {...props} />
    ),
  };
}

// Created lazily on first render (not at module scope): chunk evaluation
// order can otherwise hit the SyntaxHighlighter binding before its
// initializer runs (SSR ReferenceError) in production chunk graphs.
let cachedBaseComponents: any = null;
let cachedStaticComponents: any = null;

function getBaseComponents() {
  if (!cachedBaseComponents) {
    cachedBaseComponents = memoizeMarkdownComponents({
      SyntaxHighlighter,
      CodeHeader,
      ...sharedComponents(),
      code: function Code({ className, children, ...props }: any) {
        const isCodeBlock = useIsMarkdownCodeBlock();
        return (
          <code
            className={cn(
              !isCodeBlock && "aui-md-inline-code rounded bg-muted px-1.5 py-0.5 text-sm font-mono",
              className,
            )}
            {...props}
          >
            {children}
          </code>
        );
      },
    });
  }
  return cachedBaseComponents;
}

function getStaticComponents() {
  if (!cachedStaticComponents) {
    cachedStaticComponents = {
      ...sharedComponents(),
      code: function StaticCode({ className, children, ...props }: any) {
        const raw = fenceText(children);
        const language = /language-([\w-]+)/.exec(className || "")?.[1];
        const isBlock = !!language || raw.includes("\n");
        if (!isBlock) {
          return (
            <code
              className={cn(
                "aui-md-inline-code rounded bg-muted px-1.5 py-0.5 text-sm font-mono",
                className,
              )}
              {...props}
            >
              {children}
            </code>
          );
        }
        return <SyntaxHighlighter language={language || "text"} code={raw.replace(/\n$/, "")} />;
      },
    };
  }
  return cachedStaticComponents;
}

function getDefaultComponents(): any {
  return { ...getBaseComponents(), fileCard: MdFileCardNode, fileCardGroup: MdFileCardGroupNode };
}

// Lazily assigned on first render (see getBaseComponents); kept as a live
// binding so existing import sites keep working.
export let defaultComponents: any = undefined;

export function MarkdownText() {
  if (!defaultComponents) defaultComponents = getDefaultComponents();
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm, remarkFileRefs, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      className="aui-md"
      components={defaultComponents}
      preprocess={preprocessMarkdown}
      smooth={{ drainMs: 280, maxCharIntervalMs: 5, minCommitMs: 16 }}
    />
  );
}

/**
 * Static markdown for contexts that are not a message part (generative UI
 * components, subagent steps). Uses the same styling, math delimiters and
 * syntax highlighting as MarkdownText.
 */
const StaticMarkdownImpl = ({ text, className }: { text: string; className?: string }) => {
  const components = getStaticComponents();
  return (
    <div className={cn("aui-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {preprocessMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
};

export const StaticMarkdown = memo(StaticMarkdownImpl);

export { MarkdownTextPrimitive, remarkGfm };

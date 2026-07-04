"use client";

import "@assistant-ui/react-markdown/styles/dot.css";
import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState, type FC, useCallback } from "react";
import remarkGfm from "remark-gfm";
import { SyntaxHighlighter } from "./shiki-highlighter";
import { TooltipIconButton } from "./tooltip-icon-button";

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

const defaultComponents = memoizeMarkdownComponents({
  SyntaxHighlighter,
  CodeHeader,
  h1: ({ className, ...props }) => (
    <h1 className={cn("aui-md-h1 mb-4 mt-6 text-2xl font-bold", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("aui-md-h2 mb-3 mt-5 text-xl font-semibold", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("aui-md-h3 mb-2 mt-4 text-lg font-medium", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("aui-md-p mb-4 leading-7", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a className={cn("aui-md-a text-primary underline underline-offset-2", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn("aui-md-blockquote border-l-4 border-primary/30 pl-4 italic text-muted-foreground", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("aui-md-ul mb-4 list-disc pl-6", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("aui-md-ol mb-4 list-decimal pl-6", className)} {...props} />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li mb-1", className)} {...props} />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("aui-md-hr my-6 border-border/50", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="mb-4 overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className={cn("aui-md-table w-full border-collapse text-sm", className)} {...props} />
      </div>
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead className={cn("aui-md-thead bg-muted/50", className)} {...props} />
  ),
  tbody: ({ className, ...props }) => (
    <tbody className={cn("aui-md-tbody", className)} {...props} />
  ),
  tr: ({ className, ...props }) => (
    <tr className={cn("aui-md-tr border-b border-border/50 last:border-b-0", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th className={cn("aui-md-th px-4 py-2 text-left font-medium", className)} {...props} />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("aui-md-td px-4 py-2", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre className={cn("aui-md-pre mb-4", className)} {...props} />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock && "aui-md-inline-code rounded bg-muted px-1.5 py-0.5 text-sm font-mono",
          className,
        )}
        {...props}
      />
    );
  },
});

export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
    />
  );
}

export { MarkdownTextPrimitive, defaultComponents, remarkGfm };

"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Compact markdown styling for legal documents (terms & privacy)
// Matches the previous tiny text style but driven by markdown source
const legalComponents = {
  h1: ({ className, ...props }: any) => (
    <h1 className={cn("text-foreground font-bold text-sm mt-4 mb-2 first:mt-0", className)} {...props} />
  ),
  h2: ({ className, ...props }: any) => (
    <h2 className={cn("text-foreground font-semibold text-xs mt-4 mb-1.5", className)} {...props} />
  ),
  h3: ({ className, ...props }: any) => (
    <h3 className={cn("text-foreground font-semibold text-xs mt-3 mb-1", className)} {...props} />
  ),
  h4: ({ className, ...props }: any) => (
    <h4 className={cn("text-foreground font-semibold text-xs mt-3 mb-1", className)} {...props} />
  ),
  p: ({ className, ...props }: any) => (
    <p className={cn("mb-2 leading-relaxed", className)} {...props} />
  ),
  a: ({ className, ...props }: any) => (
    <a className={cn("text-primary underline underline-offset-2 hover:text-primary/80", className)} {...props} />
  ),
  blockquote: ({ className, ...props }: any) => (
    <blockquote className={cn("border-l-2 border-border pl-3 italic my-2 text-muted-foreground/80", className)} {...props} />
  ),
  ul: ({ className, ...props }: any) => (
    <ul className={cn("list-disc pl-4 mb-2 space-y-1", className)} {...props} />
  ),
  ol: ({ className, ...props }: any) => (
    <ol className={cn("list-decimal pl-4 mb-2 space-y-1", className)} {...props} />
  ),
  li: ({ className, ...props }: any) => (
    <li className={cn("leading-relaxed", className)} {...props} />
  ),
  hr: ({ className, ...props }: any) => (
    <hr className={cn("my-4 border-border/60", className)} {...props} />
  ),
  strong: ({ className, ...props }: any) => (
    <strong className={cn("font-semibold text-foreground", className)} {...props} />
  ),
  em: ({ className, ...props }: any) => (
    <em className={cn("italic", className)} {...props} />
  ),
  code: ({ className, children, ...props }: any) => {
    const isBlock = String(children ?? "").includes("\n");
    if (isBlock) {
      return (
        <pre className={cn("rounded-lg bg-muted p-3 text-[11px] overflow-x-auto my-2", className)}>
          <code {...props}>{children}</code>
        </pre>
      );
    }
    return (
      <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[11px]", className)} {...props}>
        {children}
      </code>
    );
  },
};

function LegalMarkdown({ content }: { content: string }) {
  // Strip script tags for safety, mirroring other markdown usages
  const clean = content.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={legalComponents}>
      {clean}
    </ReactMarkdown>
  );
}

function useLegalDocument(url: string, staticFallbackUrl?: string) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Primary: API (reads TERMS.md/PRIVACY.md from the bundle). Fallback:
    // static copy baked into public/legal by scripts/sync-legal.js — covers
    // production layouts where the API file lookup misses (seen on Windows).
    const sources = staticFallbackUrl ? [url, staticFallbackUrl] : [url];
    (async () => {
      let lastErr: string | null = null;
      for (const src of sources) {
        try {
          const res = await fetch(src, { cache: "no-store" });
          if (!res.ok) throw new Error(`${src}: ${res.status}`);
          const text = await res.text();
          // The API returns JSON { error } on failure — that is not the
          // document. Fall through to the static copy in that case.
          const trimmed = text.trimStart();
          if (trimmed.startsWith("{")) {
            try {
              const parsed = JSON.parse(text);
              if (parsed && typeof parsed.error === "string") {
                throw new Error(parsed.error);
              }
            } catch (e) {
              // Valid JSON but not markdown — not the document.
              if (e instanceof SyntaxError) throw new Error(`Unexpected content from ${src}`);
              throw e;
            }
          }
          if (!cancelled) {
            setContent(text);
            setError(null);
          }
          return;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      if (!cancelled) setError(lastErr || "Failed to load document");
    })()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, staticFallbackUrl, attempt]);

  return { content, error, loading, retry: () => setAttempt((a) => a + 1) };
}

function LegalError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-destructive text-xs">Failed to load document: {message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs font-medium text-primary hover:underline"
      >
        Retry
      </button>
    </div>
  );
}

export function TermsContent() {
  const { content, error, loading, retry } = useLegalDocument("/api/legal/terms", "/legal/terms.md");

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-5/6" />
        <div className="h-3 bg-muted rounded w-full" />
      </div>
    );
  }

  if (error) {
    return <LegalError message={`Terms: ${error}`} onRetry={retry} />;
  }

  if (!content) {
    return <p className="text-xs text-muted-foreground">No Terms content available.</p>;
  }

  return (
    <div id="qube-terms" className="scroll-mt-4">
      <LegalMarkdown content={content} />
    </div>
  );
}

export function PrivacyContent() {
  const { content, error, loading, retry } = useLegalDocument("/api/legal/privacy", "/legal/privacy.md");

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-5/6" />
        <div className="h-3 bg-muted rounded w-full" />
      </div>
    );
  }

  if (error) {
    return <LegalError message={`Privacy Policy: ${error}`} onRetry={retry} />;
  }

  if (!content) {
    return <p className="text-xs text-muted-foreground">No Privacy Policy content available.</p>;
  }

  return (
    <div id="qube-privacy" className="scroll-mt-4">
      <LegalMarkdown content={content} />
    </div>
  );
}

export function TermsPrivacyContent() {
  const terms = useLegalDocument("/api/legal/terms", "/legal/terms.md");
  const privacy = useLegalDocument("/api/legal/privacy", "/legal/privacy.md");

  const loading = terms.loading || privacy.loading;

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
        </div>
        <div className="h-px bg-border" />
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
        </div>
      </div>
    );
  }

  // Acceptance is never blocked by a load failure: the checkbox below stays
  // usable and each document can be retried independently.
  return (
    <div className="space-y-6">
      {terms.error ? (
        <LegalError message={`Terms: ${terms.error}`} onRetry={terms.retry} />
      ) : terms.content ? (
        <div id="qube-terms" className="scroll-mt-4">
          <LegalMarkdown content={terms.content} />
        </div>
      ) : null}

      {privacy.error ? (
        <LegalError message={`Privacy Policy: ${privacy.error}`} onRetry={privacy.retry} />
      ) : privacy.content ? (
        <div id="qube-privacy" className="scroll-mt-4">
          <LegalMarkdown content={privacy.content} />
        </div>
      ) : null}
    </div>
  );
}

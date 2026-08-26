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

function useLegalDocument(url: string) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
        const text = await res.text();
        if (!cancelled) {
          setContent(text);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { content, error, loading };
}

export function TermsContent() {
  const { content, error, loading } = useLegalDocument("/api/legal/terms");

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
    return <p className="text-destructive text-xs">Failed to load Terms: {error}</p>;
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
  const { content, error, loading } = useLegalDocument("/api/legal/privacy");

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
    return <p className="text-destructive text-xs">Failed to load Privacy Policy: {error}</p>;
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
  const terms = useLegalDocument("/api/legal/terms");
  const privacy = useLegalDocument("/api/legal/privacy");

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

  return (
    <div className="space-y-6">
      {terms.error ? (
        <p className="text-destructive text-xs">Failed to load Terms: {terms.error}</p>
      ) : terms.content ? (
        <div id="qube-terms" className="scroll-mt-4">
          <LegalMarkdown content={terms.content} />
        </div>
      ) : null}

      {privacy.error ? (
        <p className="text-destructive text-xs">Failed to load Privacy Policy: {privacy.error}</p>
      ) : privacy.content ? (
        <div id="qube-privacy" className="scroll-mt-4">
          <LegalMarkdown content={privacy.content} />
        </div>
      ) : null}
    </div>
  );
}

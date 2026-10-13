"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAui } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";
import {
  buildSandboxSrcDoc,
  clampHeight,
  type GenerativeUIArgs,
} from "@/lib/generative-ui/sandbox";

export type { GenerativeUIKind } from "@/lib/generative-ui/sandbox";

/**
 * Chromeless sandboxed frame — the visual itself, no header, no buttons.
 * Shared by the tool card and by inline ```genui fences in markdown so
 * the agent can place a visual anywhere inside its response.
 */
export function GenerativeUIFrame({
  args,
  title,
}: {
  args: GenerativeUIArgs;
  title?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [liveHeight, setLiveHeight] = useState(() => clampHeight(args.height));
  const srcDoc = useMemo(
    () => buildSandboxSrcDoc(args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.html, args.css, args.js],
  );
  const frameTitle =
    title ??
    (typeof args.title === "string" && args.title.trim()
      ? args.title.trim().slice(0, 120)
      : "Interactive answer");

  let aui: ReturnType<typeof useAui> | null = null;
  try {
    aui = useAui();
  } catch {
    aui = null;
  }

  // Host side of the sandbox bridge: the iframe posts bounded resize
  // messages and user-clicked follow-ups. The event source is validated
  // against this frame's own iframe so sibling visuals cannot resize or
  // speak for each other.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        const frame = iframeRef.current;
        if (!frame || e.source !== frame.contentWindow) return;
        const data = e.data as Record<string, unknown> | null;
        if (!data || typeof data !== "object") return;
        if (data.__qubeGenerativeUIHeight === true) {
          const h = Number(data.height);
          if (Number.isFinite(h)) setLiveHeight(clampHeight(h));
          return;
        }
        if (data.__qubeGenerativeUI === true) {
          const text = String((data as { text?: unknown }).text || "").slice(0, 2000);
          if (!text.trim() || !aui) return;
          try {
            aui.thread().append({ content: [{ type: "text", text }] } as never);
          } catch {}
        }
      } catch {}
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [aui]);

  return (
    <iframe
      ref={iframeRef}
      title={frameTitle}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ width: "100%", height: liveHeight, border: 0, display: "block", background: "var(--background)" }}
    />
  );
}

export const GenerativeUIToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const a = (args || {}) as GenerativeUIArgs;
  const verb = friendlyToolLabel("generate_ui", args);
  const running = (status as { type?: string } | undefined)?.type === "running";

  const hasPayload =
    (typeof a.html === "string" && a.html.trim().length > 0) ||
    (typeof a.css === "string" && a.css.trim().length > 0);

  if (!hasPayload && running) {
    return <ToolRow verb={verb} summary="Cooking up something visual…" status={status} />;
  }

  if (!hasPayload) {
    let note = "Nothing visual came back.";
    try {
      if (typeof result === "string" && result.trim()) {
        const parsed = JSON.parse(result);
        if (parsed && typeof parsed.note === "string") note = parsed.note;
        else if (parsed && typeof parsed.error === "string") note = parsed.error;
      }
    } catch {}
    return <ToolRow verb={verb} summary={note.slice(0, 120)} status={status} />;
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/60 bg-background">
      <GenerativeUIFrame args={a} />
    </div>
  );
};

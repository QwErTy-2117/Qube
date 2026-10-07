"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { XIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useChatCenter } from "@/components/updater/use-chat-center";

type ChatError = {
  title: string;
  message: string;
  detail?: string;
  status?: number;
};

// Matches every harness-written error hint (formatProviderError templates,
// config/model/stream failures, cancellation notices) plus provider
// rate-limit payloads — anything the agent would otherwise print INTO the
// chat transcript. Normal replies never start with these or contain the
// hint templates.
const ERROR_PATTERNS: RegExp[] = [
  /^error[\s\[:]/i,
  /^(configuration error|model error|pi execution error|request timed out|cancelled:|streaming interrupted:)/i,
  /open settings → model/i,
  /rate-limited \/ out of chat quota|out of chat quota/i,
  /rejected the api key/i,
  /blocked upstream/i,
  /was not found on this endpoint/i,
  /only serves to its own official client|free-tier model/i,
  /usage_limit_reached|responses_request_failed|usage_limit/i,
  /does not exist or you do not have access|model_not_found/i,
];

/** True when an assistant text part is an error notice, not a reply. */
export function isAgentErrorText(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  return ERROR_PATTERNS.some((re) => re.test(text));
}

// Dedupe: the same error text re-renders on every keystroke/stream chunk.
const notifiedKeys = new Set<string>();

/** Push an error toast for raw agent error text. Toasts at most once per text. */
export function notifyAgentError(text: string, status?: number): boolean {
  if (!isAgentErrorText(text)) return false;
  const key = text.slice(0, 160);
  if (notifiedKeys.has(key)) return true;
  if (notifiedKeys.size > 50) {
    const first = notifiedKeys.values().next().value;
    if (first !== undefined) notifiedKeys.delete(first);
  }
  notifiedKeys.add(key);
  const parsed = parseChatGPTError(text);
  pushChatError(
    parsed ?? {
      title: "An error occurred",
      message: text.slice(0, 600),
      detail: text.length > 600 ? text : undefined,
      status,
    },
  );
  return true;
}

// Global error bus — any part of the app can push a chat error
type Listener = (err: ChatError) => void;
const listeners = new Set<Listener>();

export function pushChatError(err: ChatError) {
  for (const l of listeners) l(err);
}

export function useChatErrorListener(cb: (err: ChatError) => void) {
  useEffect(() => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, [cb]);
}

export function ChatErrorTopPopup() {
  const [error, setError] = useState<ChatError | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const listener = (err: ChatError) => {
      setError(err);
      // Auto-hide a bit faster than before (10s → 7.5s)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setError((prev) => (prev === err ? null : prev));
      }, 7500);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setError(null);
  };

  // Never repeat the title inside the body: strip a leading title prefix and
  // drop detail when it merely duplicates the message.
  const dedupedBody = (() => {
    if (!error) return "";
    const title = (error.title || "").trim();
    let msg = (error.message || "").trim();
    let det = (error.detail || "").trim();
    if (title && msg.toLowerCase().startsWith(title.toLowerCase())) {
      msg = msg.slice(title.length).replace(/^[\s:–—-]+/, "").trim() || msg;
    }
    if (det && (det === msg || det.toLowerCase().startsWith(msg.toLowerCase().slice(0, 80)))) {
      det = "";
    }
    if (det && title && det.toLowerCase().startsWith(title.toLowerCase())) {
      det = det.slice(title.length).replace(/^[\s:–—-]+/, "").trim();
    }
    return det && det !== msg ? `${msg}\n\n${det}`.trim() : msg;
  })();

  return (
    <ErrorPopupPortal error={error} body={dedupedBody} onDismiss={dismiss} />
  );
}

function ErrorPopupPortal({
  error,
  body,
  onDismiss,
}: {
  error: ChatError | null;
  body: string;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Centered on the chat column like the update toast — not the whole
  // window (the browser panel would otherwise pull it off-center), unless
  // a dialog (e.g. settings) is open, in which case it centers on the
  // whole screen (i.e. centered to the dialog).
  const centerX = useChatCenter(mounted && !!error);

  if (!mounted || typeof document === "undefined") return null;

  const node = (
    <AnimatePresence>
      {error && (
        <motion.div
          key={error.title + error.message}
          initial={{ y: -24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -24, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
          className="fixed top-4 z-[100] w-[480px] max-w-[calc(100vw-2rem)] -translate-x-1/2"
          style={{ left: centerX ?? "50%" }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="relative overflow-hidden rounded-[26px] border border-red-600 bg-red-600 shadow-xl shadow-red-900/30">
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss error"
              className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-white/10 text-white/80 transition-opacity hover:bg-white/20 hover:text-white"
            >
              <XIcon className="size-4" />
            </button>
            <div className="px-4 pt-4 pb-3 pr-12">
              <h4 className="text-[14px] font-semibold tracking-tight text-white leading-none">
                {error.title || "An error occurred"}
              </h4>
              <p className="text-[12.5px] text-white/85 leading-relaxed mt-1.5 whitespace-pre-wrap break-words max-h-[30vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {body}
              </p>
              {error.status ? (
                <p className="text-[11px] text-white/60 mt-1.5">Status: {error.status}</p>
              ) : null}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(node, document.body);
}

// Helper to parse the ChatGPT 429 error from the stream's errorText
export function parseChatGPTError(errorText: string): ChatError | null {
  try {
    const data = JSON.parse(errorText);
    // AI SDK APICallError shape ({statusCode, responseBody}) or our handler's
    // {error:"responses_request_failed", status, detail} shape.
    let body: any = data.responseBody ? JSON.parse(data.responseBody) : data;
    // Handler wraps upstream: {error, status, detail: "<upstream json>"}
    let detail: any = null;
    try {
      detail = body?.detail ? JSON.parse(body.detail) : null;
    } catch {
      detail = null;
    }
    const err = detail?.error || body?.error || data;
    const errObj = typeof err === "string" ? { message: err } : err || {};
    if (errObj?.type === "usage_limit_reached" || /usage_limit/i.test(errObj?.message || "")) {
      const plan = errObj.plan_type;
      const resetsIn = errObj.resets_in_seconds ? `${Math.ceil(errObj.resets_in_seconds / 3600)}h` : "later";
      const message = errObj.message || "The usage limit has been reached";
      // Don't repeat the message inside detail — title shows once on top,
      // message once below, detail only carries plan/reset extras.
      const extras = [plan ? `Plan: ${plan}` : null, `Resets in: ${resetsIn}`].filter(Boolean).join(" • ");
      return {
        title: "ChatGPT usage limit reached",
        message,
        detail: extras || undefined,
        status: data.statusCode || data.status || 429,
      };
    }
    const status = data.statusCode || data.status || body?.status;
    // ChatGPT model gone/plan-gated — clean title, no JSON dump.
    const notFound =
      /model_not_found/i.test(errorText) ||
      /does not exist or you do not have access/i.test(errorText);
    if (notFound) {
      const m =
        errObj?.message ||
        (typeof body?.message === "string" && body.message) ||
        "This model does not exist on your ChatGPT plan";
      return {
        title: "ChatGPT model unavailable",
        message: m,
        detail: "Pick a model from Settings → ChatGPT → models (your plan's live list), then resend.",
        status: status || 404,
      };
    }
    // Generic 429 — keep detail short and never echo the full raw payload
    // when it duplicates the message.
    if (status === 429) {
      const message = (typeof body?.message === "string" && body.message) || errObj?.message || "Rate limited — please try again in a moment";
      return {
        title: `Request failed (${status})`,
        message,
        detail: undefined,
        status,
      };
    }
  } catch {}
  return null;
}

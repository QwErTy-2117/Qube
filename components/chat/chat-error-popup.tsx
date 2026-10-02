"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

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

  useChatErrorListener((err) => {
    setError(err);
    // Auto-hide after 10s
    setTimeout(() => {
      setError((prev) => (prev === err ? null : prev));
    }, 10000);
  });

  // Error toast: updater-toast geometry, but red, no buttons, no dialog —
  // just the fixed title plus the error details.
  const body =
    error && error.detail && error.detail !== error.message
      ? `${error.message}\n\n${error.detail}`
      : error?.message ?? "";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4">
      <AnimatePresence>
        {error && (
          <motion.div
            key={error.title + error.message}
            initial={{ y: -24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
            className="pointer-events-auto w-full max-w-[480px]"
          >
            <div className="rounded-[26px] border border-red-800 bg-red-600 shadow-xl shadow-red-900/30 overflow-hidden">
              <div className="px-4 pt-4 pb-3">
                <h4 className="text-[14px] font-semibold tracking-tight text-white leading-none">
                  An error occurred
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
    </div>
  );
}

// Helper to parse the ChatGPT 429 error from the stream's errorText
export function parseChatGPTError(errorText: string): ChatError | null {
  try {
    const data = JSON.parse(errorText);
    const body = data.responseBody ? JSON.parse(data.responseBody) : data;
    const detail = body.detail ? JSON.parse(body.detail) : null;
    const err = detail?.error || body.error || data;
    if (err?.type === "usage_limit_reached" || /usage_limit/i.test(err?.message || "")) {
      const plan = err.plan_type || "free";
      const resetsIn = err.resets_in_seconds ? `${Math.ceil(err.resets_in_seconds / 3600)}h` : "later";
      return {
        title: "ChatGPT usage limit reached",
        message: err.message || "The usage limit has been reached",
        detail: `Plan: ${plan} • Resets in: ${resetsIn} • ${err.message || ""}\n\nFull detail: ${JSON.stringify(err, null, 2)}`,
        status: data.statusCode || 429,
      };
    }
    // Generic 429
    if (data.statusCode === 429 || data.status === 429) {
      return {
        title: `Request failed (${data.statusCode || 429})`,
        message: data.message || err?.message || "Rate limited — please try again in a moment",
        detail: errorText,
        status: data.statusCode || 429,
      };
    }
  } catch {}
  return null;
}

"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { XIcon } from "lucide-react";

type ChatError = {
  title: string;
  message: string;
  detail?: string;
  status?: number;
};

const MAX_COMPRESSED_LENGTH = 80;

function compressText(text: string): string {
  if (text.length <= MAX_COMPRESSED_LENGTH) return text;
  return text.slice(0, MAX_COMPRESSED_LENGTH - 3) + "...";
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [visibleDetail, setVisibleDetail] = useState<ChatError | null>(null);

  useChatErrorListener((err) => {
    setError(err);
    // Auto-hide after 8s if not clicked
    setTimeout(() => {
      setError((prev) => (prev === err ? null : prev));
    }, 8000);
  });

  const handleTopClick = () => {
    if (!error) return;
    setVisibleDetail(error);
    setDetailOpen(true);
  };

  const handleCloseTop = (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(null);
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4">
        <AnimatePresence>
          {error && (
            <motion.div
              key={error.title + error.message}
              initial={{ y: -100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -100, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              onClick={handleTopClick}
              className="pointer-events-auto w-full max-w-[480px] cursor-pointer"
            >
              <div className="rounded-2xl border border-red-500/30 bg-red-500 text-white shadow-lg shadow-red-500/20 overflow-hidden">
                <div className="p-4 pr-10 relative">
                  <button
                    onClick={handleCloseTop}
                    className="absolute right-3 top-3 size-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                  <h4 className="text-sm font-semibold leading-none pr-6">{error.title}</h4>
                  <p className="text-xs font-light opacity-90 mt-1.5 line-clamp-2 leading-relaxed">
                    {compressText(error.message)}
                  </p>
                  {/* Fixed dimensions — always 72px height for compressed view */}
                  <div className="h-[72px] flex flex-col justify-center">
                    <p className="text-[11px] opacity-75 mt-1">Click for details</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg rounded-3xl bg-red-500 border-red-600 text-white p-0 overflow-hidden gap-0 [&>button]:hidden">
          <DialogHeader className="p-6 pb-3">
            <DialogTitle className="text-white text-base pr-8">{visibleDetail?.title}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 max-h-[60vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <p className="text-sm font-light leading-relaxed whitespace-pre-wrap break-words">
              {visibleDetail?.message}
            </p>
            {visibleDetail?.detail && visibleDetail.detail !== visibleDetail.message && (
              <pre className="mt-4 p-3 rounded-xl bg-white/10 text-xs font-mono whitespace-pre-wrap break-words max-h-[30vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {visibleDetail.detail}
              </pre>
            )}
            {visibleDetail?.status && (
              <p className="text-xs opacity-75 mt-3">Status: {visibleDetail.status}</p>
            )}
          </div>
          <button
            onClick={() => setDetailOpen(false)}
            className="absolute right-4 top-4 size-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <XIcon className="size-4" />
          </button>
        </DialogContent>
      </Dialog>
    </>
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

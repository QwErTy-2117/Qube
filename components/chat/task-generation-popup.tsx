"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { createPortal } from "react-dom";

import { useChatCenter } from "@/components/updater/use-chat-center";

// The same playful, non-technical voice as the tool-call labels: the user
// should never see "drafting model" or "JSON" while their task is prepared.
const GENERATION_MESSAGES = [
  "Noodling on your task…",
  "Sharpening the instructions…",
  "Plotting the schedule…",
  "Cooking up a plan…",
  "Getting the gears turning…",
];

type GenerationListener = (active: boolean) => void;
const listeners = new Set<GenerationListener>();
let activeGenerations = 0;

function emitGenerationState() {
  const active = activeGenerations > 0;
  for (const listener of listeners) listener(active);
}

/** Show the top progress toast for one task generation. Pairs with end(). */
export function beginTaskGeneration() {
  activeGenerations += 1;
  emitGenerationState();
}

/** Hide the toast once a generation finishes, fails, or is aborted. */
export function endTaskGeneration() {
  activeGenerations = Math.max(0, activeGenerations - 1);
  emitGenerationState();
}

/**
 * Black, fully rounded top toast shown while the scheduled-task generator
 * writes a name, schedule, and improved instructions. The spinner sits on
 * the right and the text is centered and shimmering, matching the playful
 * feel of the tool-call labels.
 */
export function TaskGenerationTopPopup() {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(activeGenerations > 0);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    setMounted(true);
    const listener: GenerationListener = (next) => setActive(next);
    listeners.add(listener);
    setActive(activeGenerations > 0);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    setMessageIndex(0);
    const timer = setInterval(() => {
      setMessageIndex((index) => (index + 1) % GENERATION_MESSAGES.length);
    }, 2400);
    return () => clearInterval(timer);
  }, [active]);

  // Same anchoring as the error toast: the chat column center while a chat is
  // visible, and whole-screen center when a dialog (settings) is open.
  const centerX = useChatCenter(mounted && active);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ y: -24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -24, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
          className="pointer-events-none fixed top-4 z-[100] -translate-x-1/2"
          style={{ left: centerX ?? "50%" }}
        >
          <div
            role="status"
            aria-live="polite"
            className="relative flex h-11 w-[360px] max-w-[calc(100vw-2rem)] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black px-0 text-white shadow-2xl shadow-black/30"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={messageIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="shimmer block max-w-[calc(100%-3.25rem)] text-center text-[13px] font-medium leading-none motion-reduce:animate-none"
              >
                {GENERATION_MESSAGES[messageIndex]}
              </motion.span>
            </AnimatePresence>
            <Loader2
              className="absolute right-3.5 size-4 shrink-0 animate-spin text-white/80"
              aria-hidden="true"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

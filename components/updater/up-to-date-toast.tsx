"use client";

import { motion, AnimatePresence } from "motion/react";
import { useUpdaterStore } from "@/lib/updater-store";
import { getTauriAppVersion } from "@/lib/tauri-utils";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useChatCenter } from "./use-chat-center";

export function UpToDateToast() {
  const { showUpToDate, setShowUpToDate } = useUpdaterStore();
  const [mounted, setMounted] = useState(false);
  // Version the updater compared against (the desktop binary's own version).
  // Showing it turns "up to date" from an opaque claim into a diagnostic: if
  // Settings still lists an older release, this number proves which one is
  // actually running.
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const centerX = useChatCenter(mounted && showUpToDate);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!showUpToDate) return;
    let cancelled = false;
    getTauriAppVersion().then((v) => {
      if (!cancelled) setCurrentVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, [showUpToDate]);

  useEffect(() => {
    if (!showUpToDate) return;
    const t = setTimeout(() => setShowUpToDate(false), 2000);
    return () => clearTimeout(t);
  }, [showUpToDate, setShowUpToDate]);

  if (!mounted) return null;

  const node = (
    <AnimatePresence mode="wait">
      {showUpToDate && (
        <motion.div
          key="uptodate-toast"
          initial={{ y: -24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -24, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
          className="fixed top-4 -translate-x-1/2 z-[999] w-auto max-w-[92vw] pointer-events-none"
          style={{ left: centerX ?? "50%" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-[26px] border border-[#e7e7e7] bg-white shadow-xl shadow-black/10 overflow-hidden w-auto">
            <div className="px-5 py-3 flex items-center justify-center whitespace-nowrap">
              <p className="text-[14px] font-semibold tracking-tight text-[#1e4d2f] leading-none text-center whitespace-nowrap">
                You’re up to date{currentVersion ? ` · v${currentVersion}` : ""}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(node, document.body);
}

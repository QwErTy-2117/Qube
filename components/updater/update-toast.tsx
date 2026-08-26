"use client";

import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { useUpdaterStore } from "@/lib/updater-store";
import { downloadAndInstall } from "@/lib/updater";
import { Loader2Icon } from "lucide-react";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

export function UpdateToast() {
  const { showToast, info, dismiss, downloading, setDownloading, setProgress } = useUpdaterStore();
  const [phase, setPhase] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async () => {
    if (!info) return;
    setPhase("downloading");
    setDownloading(true);
    setError(null);
    try {
      await downloadAndInstall((ev) => {
        if (ev.event === "Started") setProgress(0);
      });
      setPhase("done");
      setTimeout(() => {
        dismiss();
        setPhase("idle");
        setDownloading(false);
      }, 1500);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
      setDownloading(false);
    }
  };

  const handleCancel = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    // Ensure toast hides even if store state is stale
    try {
      dismiss();
    } catch {}
    // Fallback direct store mutation in case dismiss closure is stale
    try {
      const { setShowToast } = useUpdaterStore.getState();
      setShowToast(false);
    } catch {}
    setPhase("idle");
    setError(null);
    setDownloading(false);
    setProgress(null);
  };

  // Radius axis: outer radius = button radius (14px for h-7 rounded-full) + padding (12px)
  // => 26px. Using rounded-[26px] on popup with p-3 (12px) around the button row
  // creates a concentric axis so the button's curve follows the popup's curve.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const toastNode = (
    <AnimatePresence mode="wait">
      {showToast && info && (
        <motion.div
          key="update-toast"
          initial={{ y: -24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -24, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] w-[360px] max-w-[92vw] pointer-events-auto"
          style={{ pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="rounded-[26px] border border-[#2a5d3a] bg-[#1e4d2f] shadow-xl shadow-black/20 overflow-hidden">
            {/* content: no icon, no x, no badge, no third subtext */}
            <div className="px-4 pt-4 pb-3">
              <h4 className="text-[14px] font-semibold tracking-tight text-white leading-none">
                Update available
              </h4>
              <p className="text-[12.5px] text-white/70 leading-relaxed mt-1.5">
                Version v{info.version} is available for download, your current version is v{info.currentVersion}
              </p>
              {error && (
                <p className="text-[11px] text-red-200 mt-2 bg-white/10 border border-white/15 rounded-lg px-2 py-1">
                  {error}
                </p>
              )}
            </div>

            {/* buttons row: padding 12px (p-3) so axis aligns: outer 26 = 14 (button) + 12 */}
            <div className="px-3 pb-3 pt-0 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={downloading}
                className="rounded-full h-7 px-4 text-xs font-medium bg-white/10 border-white/15 text-white hover:bg-white/15 hover:text-white disabled:opacity-50"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpdate();
                }}
                disabled={downloading || phase === "done"}
                className="rounded-full h-7 px-4 text-xs font-semibold bg-white text-[#1e4d2f] hover:bg-white/90 border border-white min-w-[92px] justify-center whitespace-nowrap"
              >
                {phase === "downloading" || downloading ? (
                  <>
                    <Loader2Icon className="size-3.5 animate-spin mr-1" />
                    Updating…
                  </>
                ) : phase === "done" ? (
                  "Restarting…"
                ) : (
                  "Update"
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(toastNode, document.body);
}

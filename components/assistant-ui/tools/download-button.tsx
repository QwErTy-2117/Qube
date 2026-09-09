"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DownloadIcon, Loader2Icon, CheckIcon, TriangleAlertIcon } from "lucide-react";

type DlState = "idle" | "busy" | "done" | "failed";

/**
 * Icon-only download button with a smooth state machine:
 * idle → spinner while fetching → springy emerald tick once the file
 * has actually landed on disk (red alert + reason on failure).
 */
export function DownloadButton({
  filename,
  downloadUrl,
  className = "",
}: {
  filename: string;
  downloadUrl: string;
  className?: string;
}) {
  const [dl, setDl] = useState<DlState>("idle");
  const [failMsg, setFailMsg] = useState<string>("Download");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const relax = (ms = 2600) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDl("idle"), ms);
  };

  const handleDownload = async () => {
    if (dl === "busy") return;
    setDl("busy");
    try {
      let res: Response;
      try {
        res = await fetch(downloadUrl);
      } catch {
        // Network-level failure — native anchor click as fallback.
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setDl("done");
        relax();
        return;
      }
      // Server answered — a non-OK status means the file itself is bad
      // (e.g. 404); never download the error page, surface it instead.
      if (!res.ok) {
        setFailMsg(res.status === 404 ? "File not found on server" : `Download failed: ${res.status}`);
        setDl("failed");
        relax(3200);
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      setDl("done");
      relax();
    } catch (err) {
      console.error("[DownloadButton] download failed", err);
      setFailMsg(err instanceof Error ? err.message : "Download failed");
      setDl("failed");
      relax(3200);
    }
  };

  return (
    <motion.button
      onClick={handleDownload}
      disabled={dl === "busy"}
      title={dl === "failed" ? failMsg : dl === "done" ? "Downloaded" : "Download"}
      aria-label={dl === "done" ? `Downloaded ${filename}` : `Download ${filename}`}
      initial={false}
      animate={
        dl === "done"
          ? { scale: [0.6, 1.15, 1] }
          : dl === "failed"
            ? { scale: [1, 1.1, 1], x: [0, -2.5, 2.5, 0] }
            : { scale: 1, x: 0 }
      }
      transition={{ duration: 0.38, ease: "easeOut" }}
      className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 disabled:cursor-wait ${
        dl === "done"
          ? "bg-emerald-500 text-white"
          : dl === "failed"
            ? "bg-red-500 text-white"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      } ${className}`}
    >
      <span className="relative block size-4" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.span
            key={dl}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.4, rotate: dl === "done" ? -40 : 0 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {dl === "busy" ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : dl === "done" ? (
              <CheckIcon className="size-4" strokeWidth={3} />
            ) : dl === "failed" ? (
              <TriangleAlertIcon className="size-4" />
            ) : (
              <DownloadIcon className="size-4" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

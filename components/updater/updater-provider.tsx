"use client";

import { useEffect, useRef, useCallback } from "react";
import { useUpdaterStore } from "@/lib/updater-store";
import { checkForUpdates } from "@/lib/updater";
import { UpdateToast } from "./update-toast";
import { UpToDateToast } from "./up-to-date-toast";

const AUTO_CHECK_DELAY_MS = 3000; // 3s after load
const PERIODIC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
  const { setAvailable, setChecking, setLastCheckedAt, setError, setShowUpToDate } = useUpdaterStore();
  const hasCheckedRef = useRef(false);

  const doCheck = useCallback(async (isAuto = false) => {
    // Avoid concurrent checks
    const { checking } = useUpdaterStore.getState();
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await checkForUpdates();
      if (res.available) {
        setAvailable(res.info);
      } else {
        if (!isAuto) {
          // Manual check with no update -> show white "up to date" popup
          setShowUpToDate(true);
        }
      }
      setLastCheckedAt(Date.now());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Don't surface auto-check errors loudly
      if (!isAuto) setError(msg);
    } finally {
      setChecking(false);
    }
  }, [setAvailable, setChecking, setError, setLastCheckedAt, setShowUpToDate]);

  useEffect(() => {
    // Initial auto check after delay
    const t = setTimeout(() => {
      if (!hasCheckedRef.current) {
        hasCheckedRef.current = true;
        doCheck(true);
      }
    }, AUTO_CHECK_DELAY_MS);

    // Periodic checks
    const interval = setInterval(() => doCheck(true), PERIODIC_INTERVAL_MS);

    // Listen for manual trigger from settings button
    const onManual = () => doCheck(false);
    window.addEventListener("qube-check-update", onManual as EventListener);

    // Also allow dev to force-show toast for testing: dispatch qube-show-update-mock
    const onMock = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      const info = detail || { version: "9.9.9", currentVersion: "0.0.30", body: "Test update — your data will be preserved." };
      setAvailable(info);
    };
    window.addEventListener("qube-show-update-mock" as any, onMock as EventListener);

    return () => {
      clearTimeout(t);
      clearInterval(interval);
      window.removeEventListener("qube-check-update", onManual as EventListener);
      window.removeEventListener("qube-show-update-mock" as any, onMock as EventListener);
    };
  }, [doCheck, setAvailable]);

  return (
    <>
      {children}
      <UpdateToast />
      <UpToDateToast />
    </>
  );
}

// Helper to trigger manual check from any component without importing store
export function triggerUpdateCheck() {
  window.dispatchEvent(new Event("qube-check-update"));
}

// For dev/testing: trigger mock toast without network
export function triggerMockUpdate(info?: { version: string; currentVersion: string; body?: string }) {
  window.dispatchEvent(new CustomEvent("qube-show-update-mock", { detail: info }));
}

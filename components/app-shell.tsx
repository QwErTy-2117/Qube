"use client";

import type { ReactNode } from "react";
import { Base } from "@/components/examples/base";

/**
 * Persistent app shell: Base (thread UI, composer, panels) mounts ONCE per
 * full page load and survives / ↔ /chat/[id] client-side navigations.
 * Previously each page rendered its own <Base/>, so every send-driven URL
 * push unmounted the whole thread tree — making landing→chat exit
 * animations (and any cross-navigation UI continuity) impossible.
 * Page slots only contribute route effects (e.g. ChatRoute).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="h-dvh overflow-hidden">
      <Base />
      {children}
    </main>
  );
}

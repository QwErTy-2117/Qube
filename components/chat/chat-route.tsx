"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useThreadStore } from "@/lib/chat/thread-store";

/** Selects the chat from the URL (/chat/[id]); redirects home when unknown. */
export function ChatRoute({ id }: { id: string }) {
  const router = useRouter();
  const loaded = useThreadStore((s) => s.loaded);

  useEffect(() => {
    useThreadStore.getState().setSelectedId(id);
  }, [id]);

  useEffect(() => {
    if (!loaded) return;
    const known = useThreadStore.getState().threads.some((t) => t.id === id);
    if (!known) router.replace("/");
  }, [loaded, id, router]);

  return null;
}

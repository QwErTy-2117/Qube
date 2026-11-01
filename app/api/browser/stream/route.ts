import { browserStore } from "@/lib/agent/browser/browser-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of browser session state.
 * Client sends Last-Event-ID / ?sinceVersion= to resume.
 * 55s max per connection; client reconnects with version cursor.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("sinceVersion") || "0");
  let lastVersion = Number.isFinite(since) ? since : 0;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      // Initial snapshot
      try {
        const snap = browserStore.publicSnapshot();
        lastVersion = snap.version;
        send("snapshot", snap);
      } catch {}
      send("ready", { ok: true });
      const started = Date.now();
      const timer = setInterval(() => {
        try {
          if (Date.now() - started > 55_000) {
            send("end", { reason: "timeout" });
            clearInterval(timer);
            try { controller.close(); } catch {}
            return;
          }
          const snap = browserStore.publicSnapshot();
          if (snap.version !== lastVersion) {
            lastVersion = snap.version;
            send("snapshot", snap);
          } else {
            // heartbeat keeps proxies alive
            controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
          }
        } catch {
          clearInterval(timer);
          try { controller.close(); } catch {}
        }
      }, 1500);
      req.signal?.addEventListener("abort", () => {
        clearInterval(timer);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

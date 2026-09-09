import { ensureManagedChrome } from "@/lib/browser/managed-chrome";
import { subscribeFrames } from "@/lib/browser/screencast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of live browser frames (CDP screencast JPEGs, base64).
 * Subscribing starts the screencast; disconnecting stops it.
 * The Chromium window itself is never closed by this route.
 */
export async function GET(req: Request) {
  // Make sure the shared browser exists before anyone watches.
  // Bounded: never leave the EventSource hanging without an answer.
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out starting the browser (30s). Is Chrome installed?")), 30000)
    );
    await Promise.race([ensureManagedChrome(), timeout]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/browser/frames] ensure failed:", msg.slice(0, 500));
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`event: error\n` + `data: ${JSON.stringify({ message: msg })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      send("ready", { ok: true });
      const unsubscribe = subscribeFrames(({ jpg, url }) => {
        if (jpg) send("frame", { jpg, url });
        else if (url) send("url", { url });
      });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {}
      }, 15000);
      req.signal?.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try {
          unsubscribe();
        } catch {}
        try {
          controller.close();
        } catch {}
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

import { cuaEventHub, cuaSnapshot } from "@/lib/cua/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of real CUA Driver action events for the Computer panel.
 *
 * Events are published only after the driver call returns; each one carries
 * the exact screenshot-pixel coordinates that were acted on. Snapshots and
 * `Last-Event-ID` catch-up make reconnects lossless without replaying hours
 * of history.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedThread = (url.searchParams.get("threadId") || "").trim();
  const sinceRaw = Number(url.searchParams.get("since") || "0");
  const headerLastId = Number(req.headers.get("last-event-id") || "0");
  const snapshot = cuaSnapshot(requestedThread || undefined);
  const threadId = requestedThread || snapshot.threadId;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let lastId =
        Number.isFinite(sinceRaw) && sinceRaw > 0
          ? sinceRaw
          : Number.isFinite(headerLastId) && headerLastId > 0
            ? headerLastId
            : snapshot.lastEventId;
      let timer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        try {
          controller.enqueue(
            enc.encode(
              `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };
      const cleanup = () => {
        if (timer) clearInterval(timer);
        timer = null;
        try {
          unsubscribe?.();
        } catch {}
        unsubscribe = null;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      };

      // Subscribe BEFORE the snapshot so no action can slip through the gap.
      unsubscribe = cuaEventHub.subscribe((envelope) => {
        if (envelope.type === "frame") {
          if (threadId && envelope.frame.threadId !== threadId) return;
          send("frame", envelope.frame);
          return;
        }
        const event = envelope.event;
        if (threadId && event.threadId !== threadId) return;
        if (event.id <= lastId) return;
        lastId = event.id;
        send("action", event, event.id);
      });

      const missed = cuaEventHub.eventsSince(threadId || undefined, lastId);
      // On a very long disconnect, jump to the latest state instead of
      // replaying hundreds of animations. The client gets the newest real
      // position/frame immediately.
      const replay = missed.length > 60 ? [] : missed;
      const latestForSnapshot = replay.length === 0 && snapshot.latest ? snapshot.latest : null;
      send("snapshot", {
        ...snapshot,
        threadId,
        lastEventId: lastId,
        latest: latestForSnapshot,
      });
      for (const event of replay) {
        if (event.id > lastId) {
          lastId = event.id;
          send("action", event, event.id);
        }
      }
      if (missed.length > 60 && snapshot.latest) {
        lastId = snapshot.latest.id;
        send("action", snapshot.latest, snapshot.latest.id);
      }
      send("ready", { ok: true, threadId });

      const started = Date.now();
      timer = setInterval(() => {
        if (closed) return;
        if (Date.now() - started > 55_000) {
          send("end", { reason: "timeout" });
          close();
          return;
        }
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          close();
        }
      }, 15_000);
    },
    cancel() {
      // Best-effort: the start() closure owns the timers/listener and will
      // clean them up through close when the controller next writes. The
      // 55s lifetime bound guarantees no permanent leak.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

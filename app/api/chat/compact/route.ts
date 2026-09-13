import {
  maybeCompactMessages,
  getCompactionStatus,
  clearCompaction,
  getCompactionConfig,
} from "@/lib/pi/compaction";

export const maxDuration = 300;

/**
 * Manual compaction controls.
 *
 * POST   { threadId, messages, modelName?, customInstructions?, aggressive? }
 *        Force-summarize older history now (works even under threshold).
 *        Returns the summary + stats. The checkpoint persists, so the next
 *        /api/chat turn automatically sends summary + tail to the model.
 * GET    ?threadId=…  → compaction status for a thread (or config when omitted).
 * DELETE ?threadId=…  → clear a thread's checkpoint (full history sent again).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { threadId, messages, modelName, customInstructions, aggressive } = body || {};
    if (typeof threadId !== "string" || !threadId) {
      return Response.json({ error: "threadId is required" }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "messages (UIMessages array) is required" }, { status: 400 });
    }
    const result = await maybeCompactMessages({
      messages,
      threadId,
      systemPrompt: "",
      modelName: typeof modelName === "string" ? modelName : undefined,
      request: req,
      force: true,
      aggressive: aggressive === true,
      customInstructions: typeof customInstructions === "string" ? customInstructions : undefined,
    });
    return Response.json({
      compacted: result.compacted,
      freshSummary: result.freshSummary,
      hardCut: !!result.hardCut,
      failed: !!result.failed,
      uncompactable: !!result.uncompactable,
      summary: result.summary || null,
      keptMessages: result.stats.keptMessages,
      droppedMessages: result.stats.droppedMessages,
      estimatedTotalTokens: result.stats.estimatedTotalTokens,
      thresholdTokens: result.stats.thresholdTokens,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[compact] POST failed:", msg.slice(0, 500));
    return Response.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId");
    if (!threadId) {
      const cfg = getCompactionConfig();
      return Response.json({
        enabled: cfg.enabled,
        contextTokens: cfg.contextTokens,
        reserveTokens: cfg.reserveTokens,
        thresholdTokens: cfg.contextTokens - cfg.reserveTokens,
        keepRecentTokens: cfg.keepRecentTokens,
      });
    }
    const status = await getCompactionStatus(threadId);
    return Response.json({ threadId, ...status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId");
    if (!threadId) return Response.json({ error: "threadId is required" }, { status: 400 });
    await clearCompaction(threadId);
    return Response.json({ cleared: true, threadId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

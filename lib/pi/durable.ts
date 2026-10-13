import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { getDataDir } from "@/lib/data-dir";
import { join } from "node:path";

let harness: Awaited<ReturnType<typeof Harness.open>> | null = null;

export function durableDbPath(): string {
  return join(getDataDir(), "agent.sqlite");
}

export async function getDurableHarness(context = BACKGROUND_CONTEXT) {
  if (harness) return harness;
  const storage = await openNodeSqliteStorage(durableDbPath());
  const models = createModels();
  const registry = createRegistry();
  harness = await Harness.open(storage, {
    models,
    registry,
    settings: {
      compaction: { reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 32768 },
    },
  }, context);
  harness.resume();
  return harness;
}

export async function closeDurableHarness(context = BACKGROUND_CONTEXT) {
  if (!harness) return;
  await harness.close(context);
  harness = null;
}

export async function abortDurable(threadId: string, context = BACKGROUND_CONTEXT) {
  const { getOrCreateConversation } = await import("@/lib/pi/durable-conversations");
  const conv = await getOrCreateConversation(threadId, context);
  await conv.abort(context);
}

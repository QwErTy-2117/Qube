import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { getDataDir } from "@/lib/data-dir";
import { getWorkspacePath } from "@/lib/middleware/workspace";
import { join } from "node:path";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";
import { buildSkillsExtension, materializeSkills } from "@/lib/pi/durable-skills";
import { resolveProviderModule } from "@/lib/pi/durable-models";

let harness: Awaited<ReturnType<typeof Harness.open>> | null = null;
let activeRegistry: Awaited<ReturnType<typeof buildDurableRegistry>> | null = null;

export function durableDbPath(): string {
  return join(getDataDir(), "agent.sqlite");
}

/** The process-wide registry. Per-turn capabilities install into it. */
export async function getDurableRegistry() {
  if (!(harness && activeRegistry)) await getDurableHarness();
  return activeRegistry!;
}

/** All pi-ai provider factories that can be registered without credentials. */
const SINGLETON_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "deepseek",
  "xai",
  "groq",
  "together",
  "openrouter",
  "fireworks",
  "cerebras",
  "huggingface",
  "moonshot",
  "minimax",
  "azure",
  "vertexai",
  "nvidia",
];

async function buildSingletonModels() {
  const { createQubeCredentialStore } = await import("@/lib/pi/durable-credentials");
  const models = createModels({ credentials: createQubeCredentialStore() });
  for (const id of SINGLETON_PROVIDER_IDS) {
    const resolved = resolveProviderModule(id);
    if (!resolved) continue;
    try {
      const mod = await import(resolved.module);
      const factory = mod[resolved.factory] as () => Parameters<typeof models.setProvider>[0];
      models.setProvider(factory());
    } catch {
      // A provider that refuses to construct without env keys is skipped;
      // generation with it fails later with a clear provider error.
    }
  }
  return models;
}

export async function getDurableHarness(context = BACKGROUND_CONTEXT) {
  if (harness) return harness;
  const storage = await openNodeSqliteStorage(durableDbPath());
  const models = await buildSingletonModels();
  const registry = await buildDurableRegistry();
  registry.install(buildSkillsExtension(materializeSkills()));
  activeRegistry = registry;
  harness = await Harness.open(storage, {
    models,
    registry,
    env: ({ cwd }: { cwd?: string }) => new NodeExecutionEnv({ cwd: cwd ?? getWorkspacePath() }),
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
  activeRegistry = null;
}

export async function abortDurable(threadId: string, context = BACKGROUND_CONTEXT) {
  const { getOrCreateConversation } = await import("@/lib/pi/durable-conversations");
  const conv = await getOrCreateConversation(threadId, context);
  await conv.abort(context);
}

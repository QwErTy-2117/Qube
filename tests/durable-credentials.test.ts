import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-creds-test-"));
import { createQubeCredentialStore } from "@/lib/pi/durable-credentials";
import { qubeProviderForPiAi } from "@/lib/pi/durable-models";
import { providerStore } from "@/lib/pi/provider-store";

describe("durable BYOK credentials", () => {
  it("maps pi-ai provider ids back to Qube ids", () => {
    assert.equal(qubeProviderForPiAi("moonshotai"), "moonshot");
    assert.equal(qubeProviderForPiAi("amazon-bedrock"), "bedrock");
    assert.equal(qubeProviderForPiAi("openai"), "openai");
    assert.equal(qubeProviderForPiAi("nope"), undefined);
  });

  it("reads the user's stored key for a pi-ai provider", async () => {
    // Force store initialization before seeding so a later lazy init
    // cannot overwrite the seeded providers.
    providerStore.getAllProviders();
    providerStore.sync([
      { id: "openai", name: "OpenAI", enabled: true, hasApiKey: true, apiKey: " sk-test-openai ", models: [] },
      { id: "moonshot", name: "Moonshot", enabled: true, hasApiKey: true, apiKey: "sk-moonshot", models: [] },
    ], null, false);
    const store = createQubeCredentialStore();
    assert.deepEqual(await store.read("openai"), { type: "api_key", key: "sk-test-openai" });
    // pi-ai id maps to the Qube id.
    assert.deepEqual(await store.read("moonshotai"), { type: "api_key", key: "sk-moonshot" });
    // Unknown / keyless provider resolves undefined (env fallback).
    assert.equal(await store.read("groq"), undefined);
  });

  it("lists providers that have keys and never writes", async () => {
    const store = createQubeCredentialStore();
    const list = await store.list();
    assert.ok(list.some((c) => c.providerId === "openai"));
    assert.equal((await store.read("openai"))?.type, "api_key");
    assert.equal(await store.modify("openai", async () => undefined), undefined);
  });
});

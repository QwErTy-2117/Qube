/**
 * ChatGPT model-catalog helpers.
 *
 * Regression: the Codex backend only lists real chat models for a current
 * `client_version`; older SDK defaults collapsed the catalog to the internal
 * `codex-auto-review` model. Never auto-pick that model for normal chat.
 *
 * Run: npx tsx --test tests/chatgpt-models.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isInternalChatGPTModel, pickChatGPTModel } from "@/lib/chatgpt/models";
import { BUNDLED_CHATGPT_CLIENT_VERSION, getChatGPTClientVersion } from "@/lib/chatgpt/client-version";

describe("ChatGPT model selection", () => {
  it("keeps a requested model that is still on the plan", () => {
    assert.equal(pickChatGPTModel(["gpt-6-luna", "gpt-5.6-luna"], "gpt-5.6-luna"), "gpt-5.6-luna");
  });

  it("remaps a stale model to the first real chat model", () => {
    assert.equal(pickChatGPTModel(["codex-auto-review", "gpt-6-luna", "gpt-5.6-luna"], "gpt-5.5"), "gpt-6-luna");
  });

  it("only falls back to the internal review model when nothing else exists", () => {
    assert.equal(pickChatGPTModel(["codex-auto-review"], "gpt-5.5"), "codex-auto-review");
    assert.equal(pickChatGPTModel([], "gpt-5.5"), undefined);
  });

  it("detects internal review models", () => {
    assert.equal(isInternalChatGPTModel("codex-auto-review"), true);
    assert.equal(isInternalChatGPTModel("gpt-6-luna"), false);
  });
});

describe("ChatGPT Codex client version", () => {
  it("bundles a valid semver fallback", () => {
    assert.match(BUNDLED_CHATGPT_CLIENT_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("honors an explicit override", () => {
    const previous = process.env.LWC_CLIENT_VERSION;
    process.env.LWC_CLIENT_VERSION = "9.9.9";
    try {
      assert.equal(getChatGPTClientVersion(), "9.9.9");
    } finally {
      if (previous === undefined) delete process.env.LWC_CLIENT_VERSION;
      else process.env.LWC_CLIENT_VERSION = previous;
    }
  });
});

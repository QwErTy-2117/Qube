/**
 * Error-toast routing tests.
 *
 * UX rule: agent errors must NEVER render inline in the reply transcript —
 * they surface once via the red "An error occurred" toast (updater-toast
 * geometry, no buttons). AssistantText suppresses matching parts;
 * ChatErrorWatcher toasts them.
 *
 * Run: npx tsx --test tests/error-toast.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isAgentErrorText, notifyAgentError } from "@/components/chat/chat-error-popup";

describe("isAgentErrorText (harness-written error hints)", () => {
  it("matches config/model/stream/cancel failures", () => {
    assert.equal(isAgentErrorText("Configuration error: messages is empty"), true);
    assert.equal(isAgentErrorText("Model error: No model configured"), true);
    assert.equal(isAgentErrorText("Pi execution error: boom"), true);
    assert.equal(isAgentErrorText("Error [AI_APICallError]: failed"), true);
    assert.equal(isAgentErrorText("Request timed out after 300000ms"), true);
    assert.equal(isAgentErrorText("Cancelled: steered by user"), true);
  });

  it("matches provider hint templates", () => {
    assert.equal(
      isAgentErrorText('"chatgpt:gpt-5.5" is rate-limited / out of chat quota (429). Fix: check billing'),
      true,
    );
    assert.equal(isAgentErrorText('"m" rejected the API key (401). Fix: open Settings'), true);
    assert.equal(isAgentErrorText('"m" was blocked upstream (403). Fix: check dashboard'), true);
    assert.equal(isAgentErrorText("Something failed. Open Settings → Model and try another model"), true);
    assert.equal(isAgentErrorText("usage_limit_reached somewhere"), true);
  });

  it("does not match normal replies", () => {
    assert.equal(isAgentErrorText("Hi Luca! How can I help you today?"), false);
    assert.equal(isAgentErrorText("Steered — incorporating your latest message…"), false);
    assert.equal(isAgentErrorText("Here is your Daily AI News Report for today!"), false);
    assert.equal(isAgentErrorText("The build failed, so I retried with verbose logs."), false);
    assert.equal(isAgentErrorText(""), false);
  });
});

describe("notifyAgentError (toast at most once per text)", () => {
  it("notifies errors and suppresses repeats", () => {
    const text = `Configuration error: probe-${Date.now()}`;
    assert.equal(notifyAgentError(text), true);
    assert.equal(notifyAgentError(text), true); // deduped, still true
  });

  it("ignores non-error text", () => {
    assert.equal(notifyAgentError("Hello there"), false);
  });
});

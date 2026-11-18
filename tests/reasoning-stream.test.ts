import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import {
  createReasoningSseTransform,
  REASONING_TAG,
  reasoningAwareFetch,
  withReasoningExtraction,
} from "@/lib/pi/reasoning-stream";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collectText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  for await (const chunk of stream as any) out += decoder.decode(chunk, { stream: true });
  out += decoder.decode();
  return out;
}

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
  })}\n\n`;
}

describe("reasoning SSE capture", () => {
  it("rewrites reasoning deltas into tagged content and closes before text", async () => {
    const output = await collectText(
      sseStream([
        chunk({ role: "assistant" }),
        chunk({ reasoning: "Let me " }),
        chunk({ reasoning: "think." }),
        chunk({ content: "Answer" }),
        chunk({}, "stop"),
        "data: [DONE]\n\n",
      ]).pipeThrough(createReasoningSseTransform()),
    );

    assert.ok(output.includes(`"content":"<${REASONING_TAG}>Let me "`));
    assert.ok(output.includes(`"content":"think."`));
    assert.ok(output.includes(`"content":"</${REASONING_TAG}>"`));
    assert.ok(output.includes(`"content":"Answer"`));
    assert.ok(!output.includes(`"reasoning":`));
    assert.ok(output.indexOf(`<${REASONING_TAG}>`) < output.indexOf(`</${REASONING_TAG}>`));
    assert.ok(output.indexOf(`</${REASONING_TAG}>`) < output.indexOf(`"Answer"`));
  });

  it("supports reasoning_content, reasoning_details, thinking, and split chunks", async () => {
    const raw =
      chunk({ reasoning_content: "alpha " }) +
      chunk({ reasoning_details: [{ type: "reasoning.text", text: "beta " }] }) +
      chunk({ thinking: "gamma" }) +
      chunk({ tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "x", arguments: "{}" } }] }, "tool_calls") +
      "data: [DONE]\n\n";

    // Split every 7 bytes to exercise the line buffer.
    const parts: string[] = [];
    for (let i = 0; i < raw.length; i += 7) parts.push(raw.slice(i, i + 7));
    const output = await collectText(sseStream(parts).pipeThrough(createReasoningSseTransform()));

    assert.ok(output.includes("alpha "));
    assert.ok(output.includes("beta "));
    assert.ok(output.includes("gamma"));
    assert.ok(output.includes(`</${REASONING_TAG}>`));
    assert.ok(output.includes(`"tool_calls"`));
    assert.ok(!output.includes(`"reasoning_content":`));
    assert.ok(!output.includes(`"reasoning_details":`));
    assert.ok(!output.includes(`"thinking":`));
  });

  it("leaves native/non-chat SSE streams untouched", async () => {
    const raw = `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\ndata: [DONE]\n\n`;
    const output = await collectText(sseStream([raw]).pipeThrough(createReasoningSseTransform()));
    assert.equal(output, raw);
  });
});

describe("reasoning integration with streamText", () => {
  it("turns provider reasoning into AI SDK reasoning parts", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk({ role: "assistant" }));
      res.write(chunk({ reasoning_content: "Step one. " }));
      res.write(chunk({ reasoning: "Step two." }));
      res.write(chunk({ content: "Here is the answer." }));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const provider = createOpenAI({
        apiKey: "test",
        baseURL: `http://127.0.0.1:${port}/v1`,
        fetch: reasoningAwareFetch as any,
      });
      const result = streamText({
        model: withReasoningExtraction(provider.chat("test-model")),
        messages: [{ role: "user", content: "hello" }],
      });

      let reasoning = "";
      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "reasoning-delta") reasoning += part.text;
        if (part.type === "text-delta") text += part.text;
      }

      assert.equal(reasoning, "Step one. Step two.");
      assert.equal(text, "Here is the answer.");

      // The UI stream is the path the chat client consumes: reasoning must
      // survive `toUIMessageStream` (sendReasoning defaults to true).
      const uiResult = streamText({
        model: withReasoningExtraction(provider.chat("test-model")),
        messages: [{ role: "user", content: "hello" }],
      });
      let uiReasoning = "";
      let uiText = "";
      for await (const chunk of uiResult.toUIMessageStream()) {
        if (chunk.type === "reasoning-delta") uiReasoning += chunk.delta;
        if (chunk.type === "text-delta") uiText += chunk.delta;
      }
      assert.equal(uiReasoning, "Step one. Step two.");
      assert.equal(uiText, "Here is the answer.");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

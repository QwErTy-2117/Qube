/**
 * ACP tests — Qube as an ACP agent.
 *
 * Covers: content conversion, session registry, chunk->update bridge,
 * and end-to-end initialize/session/prompt over an in-process
 * AgentApp <-> ClientApp connection (stubbed LLM runner, no network).
 *
 * Run: npm run acp:test (or `npm test`)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-acp-test-"));

import * as acp from "@agentclientprotocol/sdk";
import { createQubeAcpApp } from "@/lib/acp/agent";
import { acpPromptToUIMessage } from "@/lib/acp/content";
import { createAcpBridge } from "@/lib/acp/bridge";
import {
  createAcpSession,
  getAcpSession,
  cancelAcpSession,
  __clearAcpSessions,
} from "@/lib/acp/sessions";

describe("acp content", () => {
  it("converts text + resource_link blocks", () => {
    const { message, warnings } = acpPromptToUIMessage([
      { type: "text", text: "hello" },
      { type: "resource_link", uri: "file:///a/b.ts", name: "b.ts" },
    ] as never[]);
    assert.equal((message as { role: string }).role, "user");
    const parts = (message as { parts: Array<{ text?: string }> }).parts;
    assert.equal(parts.length, 2);
    assert.match(parts[0].text || "", /hello/);
    assert.match(parts[1].text || "", /b\.ts/);
    assert.equal(warnings.length, 0);
  });

  it("downgrades audio with a warning", () => {
    const { warnings } = acpPromptToUIMessage([{ type: "audio", data: "x", mimeType: "audio/mp3" }] as never[]);
    assert.equal(warnings.length, 1);
  });
});

describe("acp sessions", () => {
  before(() => __clearAcpSessions());

  it("creates and cancels sessions", () => {
    const s = createAcpSession({ cwd: "/tmp" });
    assert.ok(s.sessionId.startsWith("acp_"));
    assert.equal(getAcpSession(s.sessionId)?.cwd, "/tmp");
    assert.equal(cancelAcpSession(s.sessionId), true);
    assert.equal(cancelAcpSession("nope"), false);
  });
});

describe("acp bridge", () => {
  it("maps text deltas to agent_message_chunk", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const bridge = createAcpBridge("s1", async (u) => { updates.push(u); });
    await bridge.write({ type: "text-delta", delta: "hi " } as never);
    await bridge.write({ type: "text-delta", delta: "there" } as never);
    await bridge.write({ type: "tool-input-start", toolCallId: "c1", toolName: "read_file" } as never);
    await bridge.write({ type: "tool-output-available", toolCallId: "c1", toolName: "read_file", output: "content!" } as never);
    assert.equal(updates.length, 4);
    assert.equal((updates[0].update as { sessionUpdate: string }).sessionUpdate, "agent_message_chunk");
    assert.equal((updates[2].update as { sessionUpdate: string }).sessionUpdate, "tool_call");
    assert.equal((updates[3].update as { sessionUpdate: string }).sessionUpdate, "tool_call_update");
    assert.equal(bridge.getToolCallCount(), 1);
  });
});

describe("acp agent (in-process)", () => {
  before(() => __clearAcpSessions());

  function testApp() {
    return createQubeAcpApp({
      promptRunner: async ({ notify }) => {
        await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "stub reply" } });
        return { cancelled: false, toolCallCount: 0 };
      },
    });
  }

  it("initialize -> session/new -> prompt -> list -> set_mode -> delete", async () => {
    const agentApp = testApp();
    const seen: Array<Record<string, unknown>> = [];
    const clientApp = acp
      .client({ name: "test-client" })
      .onNotification("session/update", async (ctx) => {
        seen.push(ctx.params as Record<string, unknown>);
      });

    await clientApp.connectWith(agentApp, async (ctx) => {
      const init = await ctx.request("initialize", {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      assert.equal(init.protocolVersion, acp.PROTOCOL_VERSION);
      assert.equal((init.agentCapabilities as { loadSession?: boolean }).loadSession, true);

      const cwd = mkdtempSync(join(tmpdir(), "qube-acp-sess-"));
      const created = await ctx.request("session/new", { cwd, mcpServers: [] });
      assert.ok(created.sessionId);

      const listed = await ctx.request("session/list", {});
      assert.ok((listed.sessions as unknown[]).some((s) => (s as { sessionId: string }).sessionId === created.sessionId));

      await ctx.request("session/set_mode", { sessionId: created.sessionId, modeId: "ask" });

      const resp = await ctx.request("session/prompt", {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "hello qube" }],
      });
      assert.equal(resp.stopReason, "end_turn");
      assert.ok(seen.length >= 1);

      await ctx.request("session/delete", { sessionId: created.sessionId });
      const listed2 = await ctx.request("session/list", {});
      assert.ok(!(listed2.sessions as unknown[]).some((s) => (s as { sessionId: string }).sessionId === created.sessionId));
    });
  });

  it("session/cancel aborts an in-flight prompt", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const agentApp = createQubeAcpApp({
      promptRunner: async ({ notify, signal }) => {
        await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "starting" } });
        await gate;
        if (signal.aborted) return { cancelled: true, toolCallCount: 0 };
        return { cancelled: false, toolCallCount: 0 };
      },
    });
    const clientApp = acp.client({ name: "test-client-2" }).onNotification("session/update", async () => {});

    await clientApp.connectWith(agentApp, async (ctx) => {
      const cwd = mkdtempSync(join(tmpdir(), "qube-acp-cancel-"));
      const created = await ctx.request("session/new", { cwd, mcpServers: [] });
      const p = ctx.request("session/prompt", {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "long task" }],
      });
      // Give the runner a tick to start, then cancel.
      await new Promise((r) => setTimeout(r, 50));
      await ctx.notify("session/cancel", { sessionId: created.sessionId });
      release();
      const resp = await p;
      assert.equal(resp.stopReason, "cancelled");
    });
  });
});

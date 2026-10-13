import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCommandTool } from "@/lib/pi/durable-shell";
import { createGuardBeforeTool } from "@/lib/pi/durable-guard";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-shell" } as never;

function outputText(result: unknown): string {
  return (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
}

function fakeMemoApi(store = new Map<string, unknown>()) {
  return {
    store,
    memo: async function (name: string, ...rest: unknown[]) {
      if (rest.length <= 1) return store.get(name) as never;
      const candidate = rest[0];
      if (!store.has(name)) store.set(name, candidate);
      return store.get(name) as never;
    },
  };
}

describe("durable shell", () => {
  it("runs benign commands with exit code", async () => {
    const parsed = JSON.parse(outputText(await runCommandTool.execute(
      { command: "echo hello-shell" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(parsed.exitCode, 0);
    assert.match(parsed.stdout, /hello-shell/);
  });

  it("reports failures with exit code instead of throwing", async () => {
    const parsed = JSON.parse(outputText(await runCommandTool.execute(
      { command: "exit 3" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(parsed.exitCode, 3);
  });

  it("times out long commands", async () => {
    const parsed = JSON.parse(outputText(await runCommandTool.execute(
      { command: "sleep 5", timeoutMs: 400 } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(parsed.timedOut, true);
  });

  it("guard blocks destructive commands, allows benign ones", async () => {
    const handler = createGuardBeforeTool();
    const blocked = await handler(
      { name: "run_command", arguments: { command: "rm -rf /tmp/x" } }, fakeMemoApi() as never, BACKGROUND_CONTEXT,
    );
    assert.match(String(blocked?.block || ""), /Approval required/);
    const allowed = await handler(
      { name: "run_command", arguments: { command: "ls -la" } }, fakeMemoApi() as never, BACKGROUND_CONTEXT,
    );
    assert.equal(allowed, undefined);
  });
});

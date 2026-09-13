/**
 * Bridge: UIMessageStream chunks (AI SDK v6, as emitted by the Pi harness)
 * -> ACP session/update notifications.
 *
 * Robust by design: switches on chunk.type strings, ignores unknown chunks.
 * TodoWrite tool results are additionally projected to ACP `plan` updates.
 */

type AnyRecord = Record<string, unknown>;
export type AcpNotify = (update: AnyRecord) => Promise<void> | void;

function toolKind(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n.includes("read") || n.includes("list") || n === "present_file") return "read";
  if (n.includes("delete")) return "delete";
  if (n.includes("edit") || n.includes("write")) return "edit";
  if (n.includes("move") || n.includes("rename")) return "move";
  if (n.includes("search") || n.includes("grep") || n.includes("glob")) return "search";
  if (n.includes("fetch") || n.includes("web_fetch")) return "fetch";
  if (n.includes("command") || n.includes("exec") || n.includes("terminal") || n.includes("run_")) return "execute";
  if (n.includes("think")) return "think";
  return "other";
}

function toolTitle(toolName: string, input: unknown): string {
  try {
    const args = input as AnyRecord | undefined;
    const p = (args?.path as string) || (args?.command as string) || (args?.query as string) || (args?.url as string) || "";
    const short = String(p).slice(0, 80);
    return short ? `${toolName} ${short}` : toolName;
  } catch {
    return toolName;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `… [truncated ${s.length - n} chars]` : s;
}

function toRawOutput(output: unknown): AnyRecord {
  if (typeof output === "string") return { content: truncate(output, 8000) };
  try {
    return JSON.parse(JSON.stringify(output ?? null)) as AnyRecord;
  } catch {
    return { content: truncate(String(output), 8000) };
  }
}

function outputToContent(output: unknown): AnyRecord[] {
  const text =
    typeof output === "string"
      ? output
      : (() => {
          try {
            const o = output as AnyRecord;
            if (o && typeof o.content === "string") return o.content as string;
            return JSON.stringify(output).slice(0, 8000);
          } catch {
            return String(output).slice(0, 8000);
          }
        })();
  if (!text) return [];
  return [{ type: "content", content: { type: "text", text: truncate(text, 8000) } }];
}

export function createAcpBridge(sessionId: string, notify: AcpNotify) {
  let toolCallCount = 0;
  const seenTools = new Set<string>();
  const toolNames = new Map<string, string>();
  const toolInputs = new Map<string, unknown>();

  async function send(update: AnyRecord): Promise<void> {
    try {
      await notify({ sessionId, update });
    } catch {
      // Client may have gone away; ignore.
    }
  }

  function resolveToolCallId(chunk: AnyRecord): string | null {
    return (
      (chunk.toolCallId as string) ||
      (chunk.id as string) ||
      null
    );
  }

  async function write(chunk: AnyRecord): Promise<void> {
    const type = chunk.type as string;

    switch (type) {
      case "text-start":
      case "text-end":
        return;

      case "text-delta": {
        const delta = (chunk.delta as string) ?? (chunk.text as string) ?? "";
        if (!delta) return;
        await send({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: delta },
        });
        return;
      }

      case "reasoning-start":
      case "reasoning-delta": {
        const delta = (chunk.delta as string) ?? (chunk.text as string) ?? "";
        if (!delta) return;
        await send({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: delta },
        });
        return;
      }
      case "reasoning-end":
        return;

      case "tool-input-start":
      case "dynamic-tool-input-start": {
        const id = resolveToolCallId(chunk);
        const toolName = (chunk.toolName as string) || "tool";
        if (id) {
          toolNames.set(id, toolName);
          if (!seenTools.has(id)) {
            seenTools.add(id);
            toolCallCount++;
          }
          await send({
            sessionUpdate: "tool_call",
            toolCallId: id,
            title: toolTitle(toolName, chunk.input ?? chunk.args),
            kind: toolKind(toolName),
            status: "pending",
            rawInput: (chunk.input ?? chunk.args ?? {}) as AnyRecord,
          });
        }
        return;
      }

      case "tool-input-delta": {
        // Streaming partial args — surface as in_progress without spamming.
        const id = resolveToolCallId(chunk);
        if (id && seenTools.has(id)) {
          const name = toolNames.get(id) || "tool";
          const prev = toolInputs.get(id);
          const delta = (chunk.delta as string) || (chunk.inputTextDelta as string) || "";
          if (typeof delta === "string" && delta) {
            const next = String((prev as string) || "") + delta;
            toolInputs.set(id, next.slice(0, 8000));
          }
          await send({
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status: "in_progress",
            title: name,
          });
        }
        return;
      }

      case "tool-input-available":
      case "dynamic-tool-input-available":
      case "tool-call":
      case "dynamic-tool-call": {
        const id = resolveToolCallId(chunk);
        const toolName = (chunk.toolName as string) || toolNames.get(id || "") || "tool";
        const input = (chunk.input ?? chunk.args ?? {}) as unknown;
        if (id) {
          if (!seenTools.has(id)) {
            seenTools.add(id);
            toolCallCount++;
          }
          toolNames.set(id, toolName);
          toolInputs.set(id, input);
          await send({
            sessionUpdate: "tool_call",
            toolCallId: id,
            title: toolTitle(toolName, input),
            kind: toolKind(toolName),
            status: "in_progress",
            rawInput: (input ?? {}) as AnyRecord,
          });
        }
        return;
      }

      case "tool-output-available":
      case "dynamic-tool-output-available":
      case "tool-result":
      case "dynamic-tool-result": {
        const id = resolveToolCallId(chunk);
        if (!id) return;
        const toolName = toolNames.get(id) || (chunk.toolName as string) || "tool";
        const output = chunk.output ?? chunk.result ?? chunk.content;
        const isError =
          (chunk.isError as boolean) === true ||
          (chunk.error as boolean) === true ||
          (typeof output === "string" && /^\s*\{"error"/.test(output));
        await send({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: isError ? "failed" : "completed",
          title: toolTitle(toolName, toolInputs.get(id)),
          content: outputToContent(output),
          rawOutput: toRawOutput(output),
        });
        // TodoWrite -> ACP plan projection
        if (toolName === "TodoWrite") {
          try {
            await maybeSendPlan(inputOf(output));
          } catch {}
        }
        return;
      }

      case "tool-output-error":
      case "tool-error": {
        const id = resolveToolCallId(chunk);
        if (!id) return;
        const toolName = toolNames.get(id) || "tool";
        await send({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: "failed",
          title: toolName,
          content: [
            {
              type: "content",
              content: { type: "text", text: truncate(String(chunk.error ?? "Tool failed"), 4000) },
            },
          ],
        });
        return;
      }

      case "error": {
        const errText = (chunk.errorText as string) || "An error occurred";
        await send({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `\n\n> Error: ${truncate(errText, 2000)}\n` },
        });
        return;
      }

      default:
        return;
    }
  }

  function inputOf(output: unknown): unknown {
    if (typeof output === "string") {
      try {
        const parsed = JSON.parse(output) as AnyRecord;
        // Pi TodoWrite execute returns a string confirmation, not the list —
        // plan projection needs the input; fall back to tracked input.
        return parsed;
      } catch {
        return output;
      }
    }
    return output;
  }

  async function maybeSendPlan(_output: unknown): Promise<void> {
    // The Pi TodoWrite tool returns only a confirmation string, so the full
    // list isn't available at output time. The input was tracked when the
    // tool call became available — project that to a plan.
    for (const [, input] of toolInputs) {
      const todos = (input as AnyRecord)?.todos as Array<AnyRecord> | undefined;
      if (Array.isArray(todos) && todos.length > 0) {
        await send({
          sessionUpdate: "plan",
          entries: todos.slice(0, 50).map((t, i) => ({
            content: String(t.content || `Step ${i + 1}`),
            status:
              t.status === "completed"
                ? "completed"
                : t.status === "in_progress"
                  ? "in_progress"
                  : "pending",
            priority: "medium",
          })),
        });
        return;
      }
    }
  }

  return {
    write,
    getToolCallCount: () => toolCallCount,
  };
}

export type AcpBridge = ReturnType<typeof createAcpBridge>;

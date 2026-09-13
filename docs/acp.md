# Qube as an ACP agent

Qube can run as an [Agent Client Protocol](https://agentclientprotocol.com/) (ACP) agent over stdio. An ACP-compatible editor (e.g. Zed) spawns Qube as a subprocess and drives it with JSON-RPC: `initialize` → `session/new` → `session/prompt` ↔ `session/update`. Prompts execute against Qube's model resolution, system prompt, and MCP loader; file/command tools are scoped to the editor session's working directory.

This is a power-user integration. Everyday use stays in the Qube app.

## Run it

```bash
npm install
npm run acp   # tsx lib/acp/stdio.ts — speaks JSON-RPC on stdin/stdout
```

| Env var         | Purpose                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `QUBE_MODEL`    | Default model as `provider:model` (e.g. `mistral:mistral-medium-2505`). Falls back to the app's configured default model. |
| `QUBE_DATA_DIR` | Data dir for providers/settings/session transcripts. Defaults to the repo (same store the app uses). |

A model must be resolvable: either `QUBE_MODEL` or a default model configured in the app (Settings → Model, same data dir). Otherwise prompts fail with "No model configured".

## Editor setup (Zed)

Zed → Agent Settings → External Agents → Add Agent → Add Custom Agent, or edit the settings file directly:

```json
{
  "agent_servers": {
    "qube": {
      "type": "custom",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/Qube/lib/acp/stdio.ts"],
      "env": {
        "QUBE_MODEL": "mistral:mistral-medium-2505"
      }
    }
  }
}
```

Use absolute paths — the editor does not run from the repo root. For a faster, dependency-free launch you can compile `stdio.ts` to JS and point `command`/`args` at `node /absolute/path/to/stdio.js` instead. Any other ACP-compatible editor works the same way: point its custom-agent command at the stdio entrypoint.

## Protocol surface

Handled requests:

| Method              | Behavior                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `initialize`        | Negotiates protocol version; advertises `loadSession`, image + embedded-context prompts, stdio MCP only, session list/delete. |
| `authenticate`      | No-op (auth is the provider key / model config on Qube's side).                                   |
| `session/new`       | Creates a session for an absolute `cwd` (+ optional `additionalDirectories`, `mcpServers`). Modes: `build` (full tools), `ask` (read-only). |
| `session/load`      | Re-attaches to a live session, or rehydrates from a persisted transcript when possible.           |
| `session/list`      | Live sessions, optionally filtered by `cwd`.                                                      |
| `session/delete`    | Aborts any in-flight turn and drops the session.                                                  |
| `session/set_mode`  | Switches between `build` and `ask`.                                                               |
| `session/prompt`    | Runs one turn; streams `session/update` notifications; returns `end_turn` / `cancelled`. A new prompt supersedes an in-flight one. |
| `session/cancel`    | Notification that aborts the in-flight turn.                                                      |

Only **stdio** MCP servers from the client are merged into a session (`http`/`sse` are not supported). Stdout carries only protocol traffic — Qube logs to stderr.

## Tools and permissions

Each session gets its own tool set, scoped to the session `cwd` (+ `additionalDirectories`):

- `read_file`, `list_directory` — always allowed inside session roots.
- `write_file`, `edit_file`, `delete_file`, `run_command` — go through `session/request_permission` (Allow / Reject) in the editor.
- `TodoWrite` — progress tracking, projected to the editor as ACP `plan` updates.
- In `ask` mode every write/execute tool refuses; reads still work.

Permission fallback: if the client has no permission UI (or the request fails), tools are allowed inside the session roots and denied outside them — session-root scoping is the backstop guard. Absolute paths outside the session roots fall back to Qube's workspace/allowed-dirs rules.

Prompt content: `text`, `resource_link`, and embedded `resource` blocks are supported, plus `image` blocks. `audio` is downgraded to a placeholder note (the chat models have no audio input) with a visible warning, as are unknown block types.

Session transcripts (title `ACP <folder>`) are persisted to Qube's session store, so ACP work shows up in the app's chat history.

## Testing

```bash
npm run acp:test   # also covered by npm test
```

Tests run the full `initialize → session/new → prompt → list → set_mode → delete` flow plus cancellation over an in-process client/agent pair with a stubbed runner — no network, no model needed.

## Current limitations

- The ACP path is leaner than chat: no skills, no long-term memory recall, no subagents/scheduler/connectors tool sets; temperature is fixed at 0.7.
- No context compaction on the ACP path yet — very long sessions can hit the model's context limit (chat has auto-compaction; see `lib/pi/compaction.ts`).
- Sessions live in memory; `session/list` only sees sessions of the running process (transcripts on disk are the durable record).
- No protocol method changes the model — it comes from `QUBE_MODEL` or the app's default model.

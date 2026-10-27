# Qube as an ACP agent

Qube can run as an [Agent Client Protocol](https://agentclientprotocol.com/)
(ACP) agent over standard input/output. An ACP-compatible editor — for
example [Zed](https://zed.dev/) with external agents — spawns Qube as a
subprocess and drives it with JSON-RPC: `initialize` → `session/new` →
`session/prompt` ↔ `session/update`.

This is a power-user integration. Everyday use stays inside the Qube desktop
app, and the ACP path is intentionally leaner than the full chat experience.

## Run it

From a source checkout with dependencies installed:

```bash
npm install
npm run acp     # tsx lib/acp/stdio.ts — JSON-RPC on stdin/stdout
```

| Variable | Purpose |
| --- | --- |
| `QUBE_MODEL` | Default model as `provider:model` (for example `openai:gpt-4.1`). Falls back to the default model configured in the app's settings. |
| `QUBE_DATA_DIR` | Data directory for providers, settings and transcripts. Defaults to the repository root — the same store the app uses. |

A model must be resolvable from either `QUBE_MODEL` or a configured default,
otherwise prompts fail with “No model configured”. Set one up in the app first
(Settings → Providers & Models) or pass `QUBE_MODEL` explicitly.

## Editor setup (Zed)

In Zed, open **Agent Settings → External Agents → Add Agent → Add Custom
Agent**, or edit the settings file directly:

```json
{
  "agent_servers": {
    "qube": {
      "type": "custom",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/Qube/lib/acp/stdio.ts"],
      "env": {
        "QUBE_MODEL": "openai:gpt-4.1"
      }
    }
  }
}
```

Use absolute paths — the editor does not launch from the repository root. For
a faster, dependency-free launch, compile `lib/acp/stdio.ts` to JavaScript and
point `command`/`args` at `node /absolute/path/to/stdio.js`. Any other
ACP-compatible editor works the same way: point its custom-agent command at
the stdio entrypoint.

## Protocol surface

| Method | Behavior |
| --- | --- |
| `initialize` | Negotiates the protocol version; advertises `loadSession`, image and embedded-context prompts, stdio-only MCP, and session list/delete. |
| `authenticate` | No-op — authentication is the provider key/model configuration on Qube's side. |
| `session/new` | Creates a session for an absolute `cwd`, with optional `additionalDirectories` and stdio `mcpServers`. Modes: `build` (full tools) and `ask` (read-only). |
| `session/load` | Re-attaches to a live session, or rehydrates from a persisted transcript when possible. |
| `session/list` | Lists live sessions, optionally filtered by `cwd`. |
| `session/delete` | Aborts any in-flight turn and drops the session. |
| `session/set_mode` | Switches between `build` and `ask`. |
| `session/prompt` | Runs one turn and streams `session/update` notifications, ending in `end_turn` or `cancelled`. A new prompt supersedes one already running. |
| `session/cancel` | Notification that aborts the in-flight turn. |

Only **stdio** MCP servers from the client are merged into a session — HTTP
and SSE transports are not supported. Standard output carries protocol
traffic only; all logging goes to standard error.

## Tools and permissions

Each session gets tools scoped to its session root (`cwd` plus
`additionalDirectories`):

- `read_file` and `list_directory` are always allowed inside the session roots.
- `write_file`, `edit_file`, `delete_file` and `run_command` go through
  `session/request_permission` (Allow / Reject) in the editor.
- `TodoWrite` tracks progress and is projected to the editor as ACP `plan`
  updates.
- In `ask` mode every write/execute tool refuses; reads still work.

If the client has no permission UI, session-root scoping acts as the backstop:
calls inside the roots are allowed and anything outside is denied. Absolute
paths outside the session roots additionally fall back to Qube's workspace and
Allowed-directory rules.

Prompt content supports text, resource links, embedded resources and images.
Audio blocks are downgraded to a placeholder with a visible warning, as are
unknown block types — the chat models have no audio input.

Session transcripts are persisted to Qube's session store (titled
`ACP <folder>`), so ACP work appears in the app's chat history.

## Current limitations

- Leaner than the chat app: no skills, no long-term memory recall, no
  subagents, scheduler or connector tool sets. Temperature is fixed at `0.7`.
- No automatic context compaction yet — very long sessions can hit the
  model's context window. The chat app compacts automatically.
- Sessions live in process memory; `session/list` sees only sessions of the
  running process, while transcripts on disk remain the durable record.
- There is no protocol method to change the model — it comes from
  `QUBE_MODEL` or the app's configured default.

## Testing

```bash
npm run acp:test    # also covered by the full npm test run
```

The suite exercises the complete
`initialize → session/new → prompt → list → set_mode → delete` flow plus
cancellation over an in-process client/agent pair with a stubbed runner — no
network access and no model calls required.

## Related reading

- [Choose your AI](./ai-providers.md) — the model configuration ACP sessions reuse
- [Environment variables](./configuration.md) — `QUBE_MODEL` and `QUBE_DATA_DIR`
- [Custom MCP servers](./mcp.md) — how stdio MCP tools are merged into sessions
- [Development and architecture](./development.md) — building from source and the test suite

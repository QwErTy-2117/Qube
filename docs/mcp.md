# Custom MCP servers

Qube supports the [Model Context Protocol](https://modelcontextprotocol.io/),
so you can extend the agent with external tools beyond the built-in file,
browser and connector sets.

## Adding a server

Open **Settings → Advanced → MCP Servers → Add server** and provide:

- **Name** — a label for the UI.
- **Command** — the executable that starts the server, for example `npx`,
  `node`, `uvx`, or an absolute path.
- **Arguments** — the command-line arguments, one per entry.
- **Environment variables** — any `KEY=value` pairs the server needs.

Only **stdio** transport is supported: Qube spawns the process and
communicates over its standard input/output. HTTP and SSE MCP servers are not
connected. Configurations are stored locally in `.memory/mcp-servers.json`
inside your [application data directory](./permissions-privacy.md#where-your-data-is-stored).

A typical entry for a fictional filesystem-style server would look like:

| Field | Value |
| --- | --- |
| Command | `npx` |
| Arguments | `-y`, `some-mcp-server` |
| Env | `API_KEY=...` (if the server requires one) |

## How Qube uses MCP tools

On each chat run, Qube starts the configured servers, discovers their tools,
and merges them into the agent's toolset alongside the built-in ones. The
model calls them like any other tool, and their activity appears as cards in
the chat.

- A server that fails to start is isolated: the other servers and all
  built-in tools keep working, and you get a visible warning naming the failed
  server and the error.
- On Windows, commands that are npm shims (`.cmd`/`.bat`, including `npx` and
  `uvx`) are wrapped automatically so they resolve the way they would in a
  terminal; bare `node` commands are redirected to the running Node binary.
- The built-in browser automation already runs as an internal MCP service —
  you don't need to add it yourself.

## Security considerations

MCP servers are local processes with whatever permissions your user account
has. Treat adding one like installing software:

- Only add servers you trust, and review what they do before installing.
- Prefer pinned versions over `latest` tags for `npx`/`uvx` commands.
- Remember that sensitive actions (sending, deleting, outside-workspace
  access) still flow through Qube's [approval system](./permissions-privacy.md)
  when the matching tools are called interactively.

## Disabling and troubleshooting

- Remove a server in the same settings screen to stop it from launching.
- If a tool seems missing, check the server actually exposes it over MCP and
  look for the startup warning in chat.
- Advanced overrides for source/self-hosted runs include
  `PI_MCP_TIMEOUT_MS` (client timeout) and, for the built-in browser service,
  `BROWSER_MCP_DISABLED` / `BROWSER_MCP_COMMAND`. See
  [Environment variables](./configuration.md).

For driving Qube itself from an editor rather than adding tools to it, see
[Qube as an ACP agent](./acp.md).

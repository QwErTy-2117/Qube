#!/usr/bin/env tsx
/**
 * Qube ACP agent — stdio entrypoint.
 *
 * Editors spawn this as a subprocess speaking JSON-RPC over stdio:
 *   Zed:  { "command": ["npx", "tsx", "/path/to/Qube/lib/acp/stdio.ts"], ... }
 *   Or compiled: node lib/acp/stdio.js
 *
 * Env:
 *   QUBE_MODEL   optional default model (e.g. "mistral:mistral-medium-2505")
 *   QUBE_DATA_DIR optional data dir (defaults to repo .memory via lib/data-dir)
 */

import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { createQubeAcpApp } from "./agent";

// ACP speaks on stdout; keep stdout clean — log to stderr.
const log = (...a: unknown[]) => console.error("[qube-acp]", ...a);

async function main(): Promise<void> {
  const app = createQubeAcpApp({
    defaultModel: process.env.QUBE_MODEL,
  });

  const toStdout = Writable.toWeb(process.stdout as unknown as NodeJS.WriteStream) as WritableStream<Uint8Array>;
  const fromStdin = Readable.toWeb(process.stdin as unknown as NodeJS.ReadStream) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(toStdout, fromStdin);

  const conn = app.connect(stream);
  log(`connected (pid=${process.pid})`);

  // Keep process alive until the client disconnects.
  await conn.closed;
  log("connection closed, exiting");
}

main().catch((e) => {
  console.error("[qube-acp] fatal:", e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});

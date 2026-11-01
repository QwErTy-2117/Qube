#!/usr/bin/env node
/**
 * CI smoke test: boot the BUNDLED browser-use MCP server exactly as the
 * production sidecar spawns it (bundled node binary + bundled server.mjs,
 * cwd = sidecar-dist) and assert tools/list succeeds.
 *
 * This is the production symptom "browser use MCP fails to start" turned
 * into a gate: it runs on Linux/Windows/macOS CI against the artifacts
 * scripts/build-sidecar.js just produced (not repo copies), so a broken
 * bundle (missing script, missing `ws`, wrong node arch, bad perms) fails
 * the job on the OS where it breaks — especially windows-latest.
 *
 * Pure Node, no deps, no shell-isms: invoked as `node scripts/smoke-mcp.js
 * [sidecar-dist-dir]` (defaults to ./sidecar-dist).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sidecarDir = path.resolve(process.argv[2] || path.join(process.cwd(), 'sidecar-dist'));
const nodeBin =
  process.platform === 'win32'
    ? path.join(sidecarDir, 'node-bin', 'node.exe')
    : path.join(sidecarDir, 'node-bin', 'node');
const script = path.join(sidecarDir, 'lib', 'browser', 'auto-mcp', 'server.mjs');

function fail(msg) {
  console.error(`SMOKE-MCP FAIL: ${msg}`);
  process.exit(1);
}

for (const [label, p] of [['bundled node', nodeBin], ['bundled server.mjs', script]]) {
  if (!fs.existsSync(p)) fail(`${label} missing at ${p} — bundle is incomplete`);
}
console.log(`SMOKE-MCP: node=${nodeBin}`);
console.log(`SMOKE-MCP: script=${script}`);

const child = spawn(nodeBin, [script], {
  cwd: sidecarDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  // Hide the console window on Windows CI runners.
  windowsHide: true,
});

const pending = new Map();
let nextId = 1;
let buf = '';
let stderrTail = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});
child.stderr.on('data', (chunk) => {
  stderrTail = (stderrTail + chunk).slice(-2000);
});
child.on('error', (e) => fail(`spawn error: ${e.message}`));

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (err) => {
      if (err) {
        pending.delete(id);
        reject(err);
      }
    });
  });
}

const timeoutMs = parseInt(process.env.SMOKE_MCP_TIMEOUT_MS || '45000', 10);
const timer = setTimeout(() => {
  try {
    child.kill();
  } catch {}
  fail(`timed out after ${timeoutMs}ms waiting for MCP handshake. stderr=${stderrTail.slice(0, 300)}`);
}, timeoutMs);

try {
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-mcp', version: '1.0' },
  });
  if (!init.result) fail(`initialize returned error: ${JSON.stringify(init).slice(0, 300)}`);

  const listed = await send('tools/list', {});
  const tools = listed?.result?.tools;
  if (!Array.isArray(tools)) fail(`tools/list returned no tools array: ${JSON.stringify(listed).slice(0, 300)}`);
  const names = tools.map((t) => t.name);
  console.log(`SMOKE-MCP: ${tools.length} tools`);
  for (const need of ['open_tab', 'snapshot', 'act']) {
    if (!names.includes(need)) fail(`missing expected browser tool "${need}" (got: ${names.slice(0, 10).join(',')})`);
  }
  console.log('SMOKE-MCP: OK');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  clearTimeout(timer);
  try {
    child.kill();
  } catch {}
}

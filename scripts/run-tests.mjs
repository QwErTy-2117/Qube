#!/usr/bin/env node
// Cross-platform test runner: creates an isolated QUBE_DATA_DIR via Node's
// os.tmpdir (works on Windows/macOS/Linux) and runs tsx --test.
// Replaces the old `QUBE_DATA_DIR=$(mktemp -d) npx tsx ...` shell prefix,
// which fails on Windows because npm executes scripts via cmd.exe even when
// the outer GitHub Actions step uses git-bash.
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const prefix = process.argv[2] === 'acp' ? 'qube-acp-test-' : 'qube-test-';
const dataDir = mkdtempSync(join(tmpdir(), prefix));
process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || dataDir;

const pattern = process.argv[2] === 'acp' ? 'tests/acp.test.ts' : 'tests/*.test.ts';
// Use shell:true so the glob expands on all platforms (cmd + bash + sh).
const res = spawnSync(`npx tsx --test ${pattern}`, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(res.status ?? 1);

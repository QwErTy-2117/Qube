#!/usr/bin/env node
/**
 * CI guard: fail the build if anything in the shipped sidecar bundle is not
 * world-readable. Called from .github/workflows/build.yml right after the
 * sidecar is built, and from scripts/build-sidecar.js after normalization.
 *
 * Usage: node scripts/check-sidecar-permissions.mjs [sidecar-dist-dir]
 */
import path from 'node:path';
import process from 'node:process';

import { assertWorldReadable } from './sidecar-permissions.mjs';

const root = path.resolve(process.argv[2] || path.join(process.cwd(), 'sidecar-dist'));

try {
  const result = assertWorldReadable(root);
  if (result.skipped) {
    console.log(`SIDECAR-PERMS: skipped on ${process.platform} (POSIX world-readable bits do not apply): ${root}`);
  } else {
    console.log(`SIDECAR-PERMS OK: ${result.checked} entries under ${root} are world-readable`);
  }
} catch (error) {
  console.error(`SIDECAR-PERMS FAIL: ${error.message}`);
  process.exit(1);
}

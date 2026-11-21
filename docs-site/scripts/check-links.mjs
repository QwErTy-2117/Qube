#!/usr/bin/env node
// Validates every internal link in the static export (./out):
//   - href/src that point inside the site must resolve to a file in out/
//   - #fragments must match an id="" in the target page
// External links are listed (count) but not fetched, so the check works
// offline and in CI without flakiness.
//
// Usage: node scripts/check-links.mjs [basePath]
//   basePath defaults to $DOCS_BASE_PATH or "" and must match the build.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'out');
const basePath = (process.argv[2] ?? process.env.DOCS_BASE_PATH ?? '').replace(/\/$/, '');

if (!fs.existsSync(outDir)) {
  console.error('[check-links] ./out does not exist — run `npm run build` first.');
  process.exit(1);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

const htmlFiles = walk(outDir).filter((f) => f.endsWith('.html'));
const idCache = new Map();

function idsOf(file) {
  if (!idCache.has(file)) {
    const html = fs.readFileSync(file, 'utf8');
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decodeEntities(m[1]))));
  }
  return idCache.get(file);
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Map a site URL path (without basePath) to a file in out/. */
function targetFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidates = [
    path.join(outDir, clean),
    path.join(outDir, clean, 'index.html'),
    path.join(outDir, clean.replace(/\/$/, '') + '.html'),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

const problems = [];
let internal = 0;
const external = new Set();

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(outDir, file);
  const pageUrl = '/' + path.dirname(rel).split(path.sep).join('/');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = decodeEntities(m[1]);
    if (/^(mailto:|tel:|data:|javascript:)/.test(raw)) continue;
    if (/^https?:\/\//.test(raw)) {
      external.add(raw);
      continue;
    }
    let urlPath;
    let fragment = '';
    const hashIdx = raw.indexOf('#');
    const beforeHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    if (hashIdx >= 0) fragment = raw.slice(hashIdx + 1);
    if (beforeHash === '') {
      urlPath = null; // same-page fragment
    } else if (beforeHash.startsWith('/')) {
      if (basePath && !beforeHash.startsWith(basePath + '/') && beforeHash !== basePath) {
        problems.push(`${rel}: "${raw}" is missing the base path "${basePath}"`);
        continue;
      }
      urlPath = beforeHash.slice(basePath.length) || '/';
    } else {
      urlPath = path.posix.join(pageUrl, beforeHash);
    }
    internal++;
    const target = urlPath === null ? file : targetFile(urlPath);
    if (!target) {
      problems.push(`${rel}: broken link "${raw}"`);
      continue;
    }
    if (fragment && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(fragment))) {
      problems.push(`${rel}: missing anchor "#${fragment}" in ${path.relative(outDir, target)}`);
    }
  }
}

console.log(`[check-links] ${htmlFiles.length} pages, ${internal} internal links checked, ${external.size} external links (not fetched)`);
if (problems.length) {
  console.error(`[check-links] ${problems.length} problem(s):\n  - ${[...new Set(problems)].join('\n  - ')}`);
  process.exit(1);
}
console.log('[check-links] OK');

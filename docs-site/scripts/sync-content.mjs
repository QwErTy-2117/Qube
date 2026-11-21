#!/usr/bin/env node
// Copies the repository's Markdown documentation into ./content/docs so
// Fumadocs can render it, without keeping a second copy in Git.
//
// - Source of truth: ../docs/**/*.md, ../TERMS.md, ../PRIVACY.md.
// - Adds `title` / `description` front matter (from the first H1 and the
//   first paragraph) and removes the H1, because the page layout renders it.
// - Rewrites relative links:
//     * links to another mapped Markdown file -> website URL (+ #anchor)
//     * links to any other file/folder in the repo -> GitHub blob/tree URL
//     * anything that does not resolve -> build error (no silent dead links)
// - Writes the meta.json files that define the sidebar.
// - Copies a few binary assets from ../public.
//
// Run from docs-site/: `node scripts/sync-content.mjs` (done by `npm run build`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site, sections, indexPage, assets } from '../site.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const repoRoot = path.resolve(siteRoot, '..');
const contentRoot = path.join(siteRoot, 'content', 'docs');
const publicRoot = path.join(siteRoot, 'public');

const errors = [];

/** repo-relative source path -> { out: content-relative file, url: site URL } */
const pageMap = new Map();

function addPage(from, outRel) {
  const slug = outRel.replace(/\.md$/, '').replace(/(^|\/)index$/, '');
  const url = '/docs' + (slug ? '/' + slug : '');
  pageMap.set(from, { out: outRel, url });
}

addPage(indexPage.from, 'index.md');
for (const section of sections) {
  for (const entry of section.pages) {
    if (entry.folder) {
      for (const p of entry.pages) addPage(p.from, `${section.dir}/${entry.folder}/${p.to}.md`);
    } else {
      addPage(entry.from, `${section.dir}/${entry.to}.md`);
    }
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function githubUrl(repoRel) {
  const abs = path.join(repoRoot, repoRel);
  const kind = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? 'tree' : 'blob';
  return `${site.repoUrl}/${kind}/${site.branch}/${repoRel}`;
}

function resolveLink(fromRepoRel, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) return target;
  const hashIdx = target.indexOf('#');
  const rawPath = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
  const anchor = hashIdx >= 0 ? target.slice(hashIdx) : '';
  if (!rawPath) return target;
  const resolved = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(fromRepoRel), decodeURI(rawPath)))).replace(/\/$/, '');
  const mapped = pageMap.get(resolved);
  if (mapped) return `${mapped.url}/${anchor}`;
  if (resolved.startsWith('..') || !fs.existsSync(path.join(repoRoot, resolved))) {
    errors.push(`${fromRepoRel}: link target "${target}" does not exist`);
    return target;
  }
  return githubUrl(resolved) + anchor;
}

/** Rewrite inline links/images and reference definitions outside code. */
function rewriteLinks(markdown, fromRepoRel) {
  const lines = markdown.split('\n');
  let fence = null;
  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1][0];
        else if (fenceMatch[1][0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      // Reference-style definitions: [id]: target
      const def = line.match(/^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/);
      if (def) return def[1] + resolveLink(fromRepoRel, def[2]) + def[3];
      // Split on inline code so `[x](y)` inside backticks is left alone.
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(/(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (_m, a, t, b) => a + resolveLink(fromRepoRel, t) + b),
        )
        .join('');
    })
    .join('\n');
}

function plainText(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function convert(fromRepoRel) {
  const abs = path.join(repoRoot, fromRepoRel);
  if (!fs.existsSync(abs)) {
    errors.push(`missing source file ${fromRepoRel}`);
    return null;
  }
  let text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  const h1 = text.match(/^# (.+)$/m);
  if (!h1) {
    errors.push(`${fromRepoRel}: no "# Title" heading`);
    return null;
  }
  const title = h1[1].trim();
  text = text.replace(h1[0], '').replace(/^\n+/, '');
  // Description: first prose paragraph (skip headings, tables, lists, quotes, code).
  let description = '';
  for (const block of text.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b || /^(#|\||-|\*|\d+\.|>|```|~~~|<)/.test(b)) continue;
    description = plainText(b);
    break;
  }
  if (description.length > 220) description = description.slice(0, 217).replace(/\s+\S*$/, '') + '…';
  const body = rewriteLinks(text, fromRepoRel);
  const front = ['---', `title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(description)}`, '---', ''];
  return front.join('\n') + body.trimEnd() + '\n';
}

function writeFile(rel, data) {
  const abs = path.join(contentRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

fs.rmSync(contentRoot, { recursive: true, force: true });
fs.mkdirSync(contentRoot, { recursive: true });

for (const [from, { out }] of pageMap) {
  const converted = convert(from);
  if (converted) writeFile(out, converted);
}

// Sidebar structure.
writeFile('meta.json', JSON.stringify({ pages: ['index', ...sections.map((s) => s.dir)] }, null, 2) + '\n');
for (const section of sections) {
  const pages = section.pages.map((e) => (e.folder ? e.folder : e.to));
  writeFile(
    `${section.dir}/meta.json`,
    JSON.stringify({ title: section.title, description: section.description, root: true, pages }, null, 2) + '\n',
  );
  for (const entry of section.pages) {
    if (!entry.folder) continue;
    writeFile(
      `${section.dir}/${entry.folder}/meta.json`,
      JSON.stringify({ title: entry.title, pages: entry.pages.map((p) => p.to) }, null, 2) + '\n',
    );
  }
}

// Assets.
for (const asset of assets) {
  const src = path.join(repoRoot, asset.from);
  const dest = path.join(publicRoot, asset.to);
  if (!fs.existsSync(src)) {
    errors.push(`missing asset ${asset.from}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (errors.length) {
  console.error(`[sync-content] ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`[sync-content] wrote ${pageMap.size} pages and ${assets.length} assets`);

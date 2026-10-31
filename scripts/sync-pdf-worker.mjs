#!/usr/bin/env node
/**
 * Copy the pdf.js worker + standard fonts into /public so the PDF viewer can
 * load them as static assets. Runs before `dev` and `build` (and after
 * install). The output is generated, not committed.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdf");

if (!existsSync(src)) {
  console.warn("[pdf-worker] pdfjs-dist is not installed yet — skipping.");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const file of ["pdf.worker.min.mjs"]) {
  const from = join(src, "build", file);
  if (existsSync(from)) cpSync(from, join(dest, file));
}
for (const dir of ["standard_fonts", "cmaps"]) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true });
}
console.log("[pdf-worker] pdf.js assets synced to public/pdf");

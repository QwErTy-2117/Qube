import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX({ configPath: 'source.config.mjs' });

// GitHub Pages serves a project site from /<repo>/. The workflow passes the
// value reported by actions/configure-pages; locally it is empty.
const basePath = (process.env.DOCS_BASE_PATH || '').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The repository root has its own lockfile (the Qube app); pin the root so
  // Turbopack never resolves modules from the app's node_modules.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};

export default withMDX(config);

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.TAURI_BUILD === "true" ? "standalone" : undefined,
  // Pi harness uses Vercel AI SDK only; no external Codex binary required.
  serverExternalPackages: [],
};

export default nextConfig;

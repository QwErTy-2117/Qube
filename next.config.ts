import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.TAURI_BUILD === "true" ? "standalone" : undefined,
  serverExternalPackages: [],
};

export default nextConfig;

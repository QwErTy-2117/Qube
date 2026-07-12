import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.TAURI_BUILD === "true" ? "standalone" : undefined,
  serverExternalPackages: ["node-screenshots"],
};

export default nextConfig;

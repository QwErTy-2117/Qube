import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.TAURI_BUILD === "true" ? "standalone" : undefined,
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;

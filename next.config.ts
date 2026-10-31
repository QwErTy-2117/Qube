import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.TAURI_BUILD === "true" ? "standalone" : undefined,
  // Pi harness uses Vercel AI SDK only; no external Codex binary required.
  serverExternalPackages: [],
  // Trim first-paint JS: these icon/animation libs are imported in many
  // places but only a few icons are used per route. Without this Next
  // bundles the whole package into the initial chunk (slow on Windows
  // WebView2 cold start + Defender scans).
  experimental: {
    optimizePackageImports: ["lucide-react", "@lobehub/icons", "motion", "@react-three/fiber", "three", "antd"],
  },
};

export default nextConfig;

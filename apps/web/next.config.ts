import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
  outputFileTracingExcludes: {
    "/api/realtime/**": [
      "./src/**/*",
      "./drizzle/**/*",
      "./*.config.*",
      "./tsconfig*.json",
      "./tsconfig*.tsbuildinfo",
    ],
  },
  transpilePackages: [
    "@ai-tutor/contracts",
    "@ai-tutor/runtime-core",
    "@ai-tutor/runtime-static-html",
    "@ai-tutor/teaching-model",
  ],
};

export default nextConfig;

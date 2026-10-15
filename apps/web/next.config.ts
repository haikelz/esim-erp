import { resolve } from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: ["@esim-erp/contracts"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    preloadEntriesOnStart: true,
    turbopackFileSystemCacheForBuild: true,
    turbopackFileSystemCacheForDev: true,
  },
};

export default async function config(phase: string): Promise<NextConfig> {
  if (phase !== PHASE_PRODUCTION_BUILD) return nextConfig;

  const { default: withPWAInit } = await import("@ducanh2912/next-pwa");
  return withPWAInit({
    dest: "public",
    cacheStartUrl: false,
    dynamicStartUrl: false,
    cacheOnFrontEndNav: false,
    extendDefaultRuntimeCaching: false,
    reloadOnOnline: false,
    workboxOptions: {
      additionalManifestEntries: [],
      include: [/^static\//],
      runtimeCaching: [
        {
          urlPattern: ({ sameOrigin }) => sameOrigin,
          handler: "NetworkOnly",
          options: {},
        },
      ],
    },
  })(nextConfig);
}

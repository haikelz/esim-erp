import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  transpilePackages: ["@esim-erp/contracts"],
};

export default nextConfig;

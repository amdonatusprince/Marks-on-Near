import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fast-auth-near/browser-sdk"],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;

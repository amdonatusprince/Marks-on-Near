import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fast-auth-near/browser-sdk"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;

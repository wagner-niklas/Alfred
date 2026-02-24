import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  serverExternalPackages: ['@databricks/sql', 'lz4'],
  // Keep any other config options you have here
};

export default nextConfig;
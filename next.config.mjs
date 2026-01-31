/** @type {import('next').NextConfig} */
const nextConfig = {
  // Packages that should stay external on the server runtime.
  // This mirrors the previous TypeScript-based next.config.ts.
  serverExternalPackages: ["@databricks/sql", "lz4"],
};

export default nextConfig;

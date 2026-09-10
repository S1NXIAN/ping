import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // All src/ type errors are fixed; non-app folders (skills/) are excluded
    // via tsconfig so a future regression fails the build instead of
    // shipping silently.
    ignoreBuildErrors: false,
  },
  // Double-invoked effects in dev catch stale-closure/cleanup bugs early —
  // every PING effect cleans up its intervals and listeners properly.
  reactStrictMode: true,
};

export default nextConfig;

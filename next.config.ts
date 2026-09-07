import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // steem-js (CJS, dynamic internals) must stay external on the server —
  // bundling it breaks its transport layer
  serverExternalPackages: ["steem"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // steem-js (CJS, dynamic internals) must stay external on the server —
  // bundling it breaks its transport layer. Same for @solana/web3.js
  // (node built-ins) and ethers (crypto dynamic imports).
  serverExternalPackages: ["steem", "@solana/web3.js", "ethers"],
};

export default nextConfig;

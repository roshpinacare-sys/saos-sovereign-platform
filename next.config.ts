import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Turbopack must root HERE, not at a parent dir that also has a lockfile
  // (nested-clone layout: my-project/bun.lock above this repo made Turbopack
  // infer the parent as workspace root and share its .next build dir — chunk
  // collisions with the decommissioned sandbox console). Explicit root = own
  // .next, zero cross-app collision.
  turbopack: {
    root: path.resolve(import.meta.dirname ?? "."),
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // steem-js (CJS, dynamic internals) must stay external on the server —
  // bundling it breaks its transport layer. Same for @solana/web3.js
  // (node built-ins) and ethers (crypto dynamic imports).
  // xrpl (v30 תזוזה): offline signing only — heavy CJS internals.
  serverExternalPackages: ["steem", "@solana/web3.js", "ethers", "xrpl"],
};

export default nextConfig;

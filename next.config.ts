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
  // v107 · OOM-lesson (caught live ×3, 2026-10-02): the dev compile storm pushed
  // next-server to 1.39–1.99GB on a 4GB box (anvil alone holds 0.83GB) and the
  // kernel killed it mid-storm. 1GB target forces earlier cache release — the
  // storm peaks lower, the kernel's global OOM never fires. (Bytes, per
  // next/dist/server/config-shared.d.ts.)
  experimental: {
    turbopackMemoryLimit: 640 * 1024 * 1024,
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

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `contract` and `api` are sibling workspaces shipped as TypeScript-built ESM.
  // Next has to run them through its own pipeline rather than treating them as
  // pre-bundled externals.
  transpilePackages: ["truemask-api", "leaderboard-contract"],

  turbopack: {
    resolveAlias: {
      // See src/shims/isomorphic-ws.ts — the upstream browser build has no
      // named `WebSocket` export, which the indexer provider requires.
      "isomorphic-ws": "./src/shims/isomorphic-ws.ts",
    },
  },
};

export default nextConfig;

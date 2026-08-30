import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hides Next's floating "N" dev-tools bubble. It is Next's own overlay, not
  // part of TrueMask, and it sits on top of the UI while demoing.
  devIndicators: false,

  // `contract` and `api` are sibling workspaces shipped as TypeScript-built ESM.
  // Next has to run them through its own pipeline rather than treating them as
  // pre-bundled externals.
  transpilePackages: ["truemask-api", "truemask-contract"],

  // Image optimization for better performance
  images: {
    unoptimized: true, // Since we're handling images as data, disable next/image optimization
  },

  // Performance improvements
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,

  turbopack: {
    resolveAlias: {
      // See src/shims/isomorphic-ws.ts — the upstream browser build has no
      // named `WebSocket` export, which the indexer provider requires.
      "isomorphic-ws": "./src/shims/isomorphic-ws.ts",
    },
  },
};

export default nextConfig;

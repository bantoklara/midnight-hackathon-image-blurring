/**
 * Shim for `isomorphic-ws`.
 *
 * `@midnight-ntwrk/midnight-js-indexer-public-data-provider` does
 * `import * as ws from "isomorphic-ws"` and then reads `ws.WebSocket`. That works
 * against the package's Node entry (CommonJS re-export of `ws`, which has a named
 * `WebSocket`), but its browser entry is `export default ws` with no named export,
 * so a bundler resolving the browser condition fails the build with
 * "Export WebSocket doesn't exist in target module".
 *
 * Both runtimes we target already have a global WebSocket (browsers, and Node 22+),
 * so this exposes it under both the default and the named export and satisfies
 * either import style. Aliased in next.config.ts.
 */

const impl: typeof WebSocket | undefined =
  typeof WebSocket !== "undefined" ? WebSocket : undefined;

export { impl as WebSocket };
export default impl;

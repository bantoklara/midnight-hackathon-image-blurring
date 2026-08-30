"use client";

import { useCallback, useMemo, useState } from "react";

import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import type { FinalizedTransaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { firstValueFrom } from "rxjs";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { parseCoinPublicKeyToHex, parseEncPublicKeyToHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import { Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  TrueMaskAPI,
  trueMaskPrivateStateKey,
  type TrueMaskCircuitKeys,
  type TrueMaskProviders,
} from "truemask-api";

/**
 * Wallet + provider wiring for TrueMask.
 *
 * WHAT WAS HERE BEFORE
 *   The previous version imported `createMidnightProvider` and `MidnightProvider`
 *   from `@midnight-ntwrk/midnight-js-contracts` and a `DAppConnectorAPI` type
 *   from `@midnight-ntwrk/dapp-connector-api`, then called `.enable()` and
 *   `.getUsedAddresses()` on the wallet. None of those exist: the first two are
 *   not among that package's exports, `DAppConnectorAPI` is not a type it
 *   declares, and `.enable()`/`.getUsedAddresses()` are Cardano-shaped. The real
 *   connector exposes `connect(networkId) -> ConnectedAPI` and
 *   `getUnshieldedAddress()`. There is no single factory for the provider bundle;
 *   `MidnightProviders` is assembled from six independent providers, which is
 *   what `buildProviders` below does.
 *
 * VERIFICATION STATUS
 *   Every import, export name and call signature here was checked against the
 *   installed .d.ts files. The one part that cannot be exercised without a Lace
 *   wallet and a running node/indexer is `walletAdapter` — the wallet speaks in
 *   serialized transaction strings while `WalletProvider` speaks in ledger
 *   objects, so the two are bridged by serialize/deserialize. That boundary is
 *   isolated in one function and flagged below.
 */

/** Where the local stack lives. Override per-environment with NEXT_PUBLIC_* vars. */
export interface MidnightConfig {
  networkId: string;
  indexerUri: string;
  indexerWsUri: string;
  proofServerUri: string;
  /**
   * Absolute URL the compiled circuit artifacts are served from. The provider
   * fetches `<base>/keys/<circuit>.prover`, `<base>/keys/<circuit>.verifier` and
   * `<base>/zkir/<circuit>.bzkir`, which is exactly the layout of
   * contract/managed/truemask. `npm run sync:zk` copies it into public/.
   * Must be absolute — the provider runs it through `new URL()` and rejects
   * anything that is not http(s).
   */
  zkConfigUri: string;
}

export const DEFAULT_CONFIG: MidnightConfig = {
  // Preprod is the demo target. Every value is overridable so a local devnet
  // still works: set NEXT_PUBLIC_NETWORK_ID=undeployed with localhost URIs.
  // The proof server is deliberately NOT remote — proving runs on this machine
  // even against a public network, so the original image never leaves it.
  networkId: process.env.NEXT_PUBLIC_NETWORK_ID ?? "preprod",
  indexerUri:
    process.env.NEXT_PUBLIC_INDEXER_URI ??
    "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWsUri:
    process.env.NEXT_PUBLIC_INDEXER_WS_URI ??
    "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  proofServerUri: process.env.NEXT_PUBLIC_PROOF_SERVER_URI ?? "http://localhost:6300",
  zkConfigUri:
    process.env.NEXT_PUBLIC_ZK_CONFIG_URI ??
    (typeof window === "undefined"
      ? "http://localhost:3000/midnight/truemask"
      : `${window.location.origin}/midnight/truemask`),
};

/** Where a reader is sent when they have no tDUST. Preprod faucet dispenses tNIGHT. */
export const FAUCET_URL = "https://faucet.preprod.midnight.network/";

/** Contract to publish into and read back from. Empty means offline-only. */
export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";

/** Wallet key injected under `window.midnight`. Lace uses `mnLace`. */
const WALLET_KEY = "mnLace";

export interface UseMidnightResult {
  providers: TrueMaskProviders | null;
  walletApi: ConnectedAPI | null;
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  isWalletAvailable: boolean;
  connect: () => Promise<{ providers: TrueMaskProviders; walletApi: ConnectedAPI }>;
  /** Deploy a fresh registry, or join the one at NEXT_PUBLIC_CONTRACT_ADDRESS. */
  getApi: () => Promise<TrueMaskAPI>;
  disconnect: () => void;
}

export function useMidnight(config: MidnightConfig = DEFAULT_CONFIG): UseMidnightResult {
  const [providers, setProviders] = useState<TrueMaskProviders | null>(null);
  const [walletApi, setWalletApi] = useState<ConnectedAPI | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [api, setApi] = useState<TrueMaskAPI | null>(null);

  const isWalletAvailable = useMemo(
    () => typeof window !== "undefined" && Boolean(window.midnight?.[WALLET_KEY]),
    [],
  );

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const connector: InitialAPI | undefined =
        typeof window === "undefined" ? undefined : window.midnight?.[WALLET_KEY];
      if (!connector) {
        throw new Error(
          "Midnight Lace wallet not found. Install the extension and reload the page.",
        );
      }

      // Must precede any provider construction — the SDK reads it globally.
      setNetworkId(config.networkId);

      const connected = await connector.connect(config.networkId);
      const { unshieldedAddress } = await connected.getUnshieldedAddress();

      // buildProviders resolves the wallet's public keys before returning, so
      // the synchronous getCoinPublicKey()/getEncryptionPublicKey() the SDK
      // calls during balancing can never observe an empty cache.
      const built = await buildProviders(connected, config);
      setWalletApi(connected);
      setAddress(unshieldedAddress);
      setProviders(built);
      return { providers: built, walletApi: connected };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect to Midnight";
      setError(message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [config]);

  const getApi = useCallback(async () => {
    if (api) return api;
    const active = providers ?? (await connect()).providers;
    const configured = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    const next = configured
      ? await TrueMaskAPI.join(active, configured as never)
      : await TrueMaskAPI.deploy(active);
    setApi(next);
    return next;
  }, [api, providers, connect]);

  const disconnect = useCallback(() => {
    setProviders(null);
    setWalletApi(null);
    setAddress(null);
    setApi(null);
    setError(null);
  }, []);

  return {
    providers,
    walletApi,
    address,
    isConnecting,
    error,
    isWalletAvailable,
    connect,
    getApi,
    disconnect,
  };
}

/**
 * Assemble the six providers `MidnightProviders` requires. There is no factory
 * for this in the SDK — each is constructed independently, and the proof
 * provider is given the ZK config provider so it can fetch prover keys.
 */
async function buildProviders(
  wallet: ConnectedAPI,
  config: MidnightConfig,
): Promise<TrueMaskProviders> {
  // Imported lazily and never at module scope: this package resolves to the
  // `classic-level` native addon under Node, which has no prebuilt binary here and
  // would crash `next build`'s prerender of a page that only ever needs it in the
  // browser. Deferring the import keeps it out of the server render path entirely.
  const { levelPrivateStateProvider } = await import(
    "@midnight-ntwrk/midnight-js-level-private-state-provider"
  );

  const zkConfigProvider = new FetchZkConfigProvider<TrueMaskCircuitKeys>(config.zkConfigUri);
  const { walletProvider, midnightProvider, ready } = walletAdapter(wallet, config);
  await ready;

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "truemask-private-state",
      accountId: (await wallet.getUnshieldedAddress()).unshieldedAddress,
      // Browser-local encryption of the private state DB. Swap for a real
      // user-supplied passphrase before this is used with production material.
      privateStoragePasswordProvider: () => "truemask-local-development-key",
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    zkConfigProvider,
    proofProvider: httpClientProofProvider<TrueMaskCircuitKeys>(
      config.proofServerUri,
      zkConfigProvider,
    ),
    walletProvider,
    midnightProvider,
  } satisfies TrueMaskProviders;
}

/**
 * Bridge the wallet's string-serialized transaction API to the object-based
 * `WalletProvider`/`MidnightProvider` interfaces.
 *
 * NOT VERIFIED END TO END. This is the only part of the file that needs a live
 * Lace wallet plus a running node and indexer to exercise, and none of those can
 * run in a headless environment. The shapes are taken from the installed
 * declarations: `balanceUnsealedTransaction(tx: string) => Promise<{ tx: string }>`
 * and `submitTransaction(tx: string) => Promise<void>` on the connector, against
 * `balanceTx(UnboundTransaction) => Promise<FinalizedTransaction>` and
 * `submitTx(FinalizedTransaction) => Promise<TransactionId>` on the providers.
 * If the wallet rejects the payload, the encoding here is the first thing to check.
 */
function walletAdapter(wallet: ConnectedAPI, config: MidnightConfig) {
  let cachedKeys: { coin: string; enc: string } | null = null;

  const loadKeys = async () => {
    if (cachedKeys) return cachedKeys;
    const shielded = await wallet.getShieldedAddresses();
    cachedKeys = {
      coin: parseCoinPublicKeyToHex(shielded.shieldedCoinPublicKey, config.networkId),
      enc: parseEncPublicKeyToHex(shielded.shieldedEncryptionPublicKey, config.networkId),
    };
    return cachedKeys;
  };
  // Awaited by buildProviders before any provider escapes this module. The
  // getters below are synchronous because the SDK calls them that way, so the
  // cache has to be filled first rather than racing against the first publish.
  const ready = loadKeys();

  const walletProvider: WalletProvider = {
    async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      const balanced = await wallet.balanceUnsealedTransaction(toHex(tx.serialize()));
      // Balanced transactions are signature-enabled, proven and bound.
      return Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        fromHexString(balanced.tx),
      ) as FinalizedTransaction;
    },
    getCoinPublicKey: () => {
      if (!cachedKeys) throw new Error("wallet keys are not loaded yet — call connect() first");
      return cachedKeys.coin as never;
    },
    getEncryptionPublicKey: () => {
      if (!cachedKeys) throw new Error("wallet keys are not loaded yet — call connect() first");
      return cachedKeys.enc as never;
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx: FinalizedTransaction) {
      await wallet.submitTransaction(toHex(tx.serialize()));
      const [identifier] = tx.identifiers();
      if (!identifier) throw new Error("submitted transaction reported no identifier");
      return identifier;
    },
  };

  return { walletProvider, midnightProvider, ready };
}

/**
 * Read a redaction record straight off the chain — no wallet, no signing, no cost.
 *
 * This is the whole point of separating the two journeys: verifying is a read,
 * so a reader needs nothing installed. Only the indexer is contacted, and a
 * failure here is never fatal to verification, which already succeeded locally.
 */
export async function lookupRecordOnChain(
  redactedImageHashHex: string,
  config: MidnightConfig = DEFAULT_CONFIG,
  contractAddress: string = CONTRACT_ADDRESS,
): Promise<"found" | "absent" | "unavailable"> {
  if (!contractAddress) return "unavailable";
  try {
    setNetworkId(config.networkId);
    const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
    const state = await firstValueFrom(
      publicDataProvider.contractStateObservable(contractAddress as never, { type: "latest" }),
    );
    const { TrueMask } = await import("truemask-contract");
    const key = hexToBytes(redactedImageHashHex);
    return TrueMask.ledger(state.data).records.member(key) ? "found" : "absent";
  } catch (err) {
    console.error("On-chain lookup failed:", err);
    return "unavailable";
  }
}

function hexToBytes(value: string): Uint8Array {
  const clean = value.trim().toLowerCase().replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function fromHexString(value: string): Uint8Array {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

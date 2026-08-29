import { useState, useCallback } from "react";
import {
  createMidnightProvider,
  MidnightProvider,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { DAppConnectorAPI } from "@midnight-ntwrk/dapp-connector-api";

declare global {
  interface Window {
    midnight?: {
      mnLace?: DAppConnectorAPI;
    };
  }
}

export function useMidnight() {
  const [provider, setProvider] = useState<MidnightProvider | null>(null);
  const [walletApi, setWalletApi] = useState<any>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      // 1. Initialize Midnight Providers (Node, Indexer, Proof Server)
      // These are standard local URLs for the Midnight development node
      const midnightProvider = await createMidnightProvider({
        indexer: "http://127.0.0.1:8088/api/v1/graphql",
        node: "http://127.0.0.1:9944",
        proofServer: "http://127.0.0.1:6300",
      });
      setProvider(midnightProvider);

      // 2. Connect to Lace Wallet
      if (!window.midnight?.mnLace) {
        throw new Error("Midnight Lace wallet extension not found. Please install it.");
      }

      const api = await window.midnight.mnLace.enable();
      setWalletApi(api);

      // 3. Get the user's connected address
      const addresses = await api.getUsedAddresses();
      if (addresses.length > 0) {
        setAddress(addresses[0]);
      }

      setIsConnecting(false);
      return { provider: midnightProvider, walletApi: api };
    } catch (err: any) {
      console.error("Wallet connection failed:", err);
      setError(err.message || "Failed to connect to Midnight");
      setIsConnecting(false);
      throw err;
    }
  }, []);

  return {
    provider,
    walletApi,
    address,
    isConnecting,
    error,
    connect,
  };
}

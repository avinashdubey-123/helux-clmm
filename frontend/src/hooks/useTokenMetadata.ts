import { useEffect, useSyncExternalStore } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  getTokenMetadataSnapshot,
  requestTokenMetadata,
  subscribeTokenMetadata,
  TokenMetadataRecord,
} from "../utils/tokenMetadata";
import { getTokenDisplay, TokenDisplay } from "../utils/token";

/**
 * Returns the metadata resolved so far (keyed by mint) and requests any of the
 * given mints that aren't resolved yet. Never blocks rendering: components
 * render with their defaults first and re-render once metadata arrives.
 */
export function useTokenMetadata(
  mints: readonly (string | null | undefined)[],
): TokenMetadataRecord {
  const { connection } = useConnection();
  const record = useSyncExternalStore(subscribeTokenMetadata, getTokenMetadataSnapshot);

  // Stable dependency for the effect regardless of array identity.
  const key = [...new Set(mints.filter(Boolean))].sort().join(",");

  useEffect(() => {
    if (key) requestTokenMetadata(connection, key.split(","));
  }, [connection, key]);

  return record;
}

/** Display values (metadata with default fallback) for a single mint. */
export function useTokenDisplay(mint: string): TokenDisplay {
  const record = useTokenMetadata([mint]);
  return getTokenDisplay(mint, record[mint]);
}

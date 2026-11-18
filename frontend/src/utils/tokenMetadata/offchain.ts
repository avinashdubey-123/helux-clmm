import { cleanMetadataString } from "./types";

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const ARWEAVE_GATEWAY = "https://arweave.net/";
const OFFCHAIN_FETCH_TIMEOUT_MS = 5000;

/** Converts `ipfs://` / `ar://` URIs to browser-fetchable HTTPS gateway URLs. */
export function toHttpUrl(uri: string | undefined): string | undefined {
  const value = cleanMetadataString(uri);
  if (!value) return undefined;
  if (value.startsWith("ipfs://")) {
    return IPFS_GATEWAY + value.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  if (value.startsWith("ar://")) {
    return ARWEAVE_GATEWAY + value.slice("ar://".length);
  }
  if (/^https?:\/\//i.test(value)) return value;
  return undefined;
}

/**
 * Fetches the off-chain metadata JSON behind a token `uri` and returns its
 * `image` URL. Some tokens point `uri` straight at an image, which is returned
 * as-is. Any failure resolves to `undefined`.
 */
export async function fetchOffchainImage(uri: string): Promise<string | undefined> {
  const url = toHttpUrl(uri);
  if (!url) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFFCHAIN_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    if (res.headers.get("content-type")?.startsWith("image/")) return url;
    const json = await res.json();
    return toHttpUrl(json?.image);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

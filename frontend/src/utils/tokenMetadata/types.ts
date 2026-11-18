/**
 * Resolved display metadata for a token mint.
 * A field is only present when it was genuinely found and is non-empty.
 */
export interface TokenMetadata {
  name?: string;
  symbol?: string;
  image?: string;
}

/** Metadata as read from chain, before the off-chain `uri` JSON is resolved. */
export interface OnchainTokenMetadata {
  name?: string;
  symbol?: string;
  uri?: string;
}

/**
 * Snapshot of everything resolved so far, keyed by mint address.
 * `null` means "looked up, nothing found" - callers keep their default display.
 */
export type TokenMetadataRecord = Readonly<Record<string, TokenMetadata | null>>;

/** Strips the null-byte padding used by on-chain fixed-length strings and trims whitespace. */
export function cleanMetadataString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/\u0000/g, "").trim();
  return cleaned || undefined;
}

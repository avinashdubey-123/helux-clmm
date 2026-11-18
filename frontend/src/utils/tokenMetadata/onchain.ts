import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionData,
  getMetadataPointerState,
  unpackMint,
} from "@solana/spl-token";
import { unpack as unpackTokenMetadata } from "@solana/spl-token-metadata";
import { callWithRetry } from "../batchFetch";
import { cleanMetadataString, OnchainTokenMetadata } from "./types";

export const METAPLEX_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

/** Max accounts per `getMultipleAccountsInfo` call allowed by the RPC spec. */
const MAX_ACCOUNTS_PER_CALL = 100;

/** Metaplex `Key::MetadataV1` discriminator (first byte of a metadata account). */
const METAPLEX_METADATA_V1_KEY = 4;

export function getMetaplexMetadataAddress(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METAPLEX_TOKEN_METADATA_PROGRAM_ID,
  )[0];
}

async function getAccountsChunked(
  connection: Connection,
  keys: PublicKey[],
): Promise<(AccountInfo<Buffer> | null)[]> {
  const results: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += MAX_ACCOUNTS_PER_CALL) {
    const chunk = keys.slice(i, i + MAX_ACCOUNTS_PER_CALL);
    results.push(
      ...(await callWithRetry(() => connection.getMultipleAccountsInfo(chunk))),
    );
  }
  return results;
}

function readBorshString(data: Buffer, offset: number): [string, number] {
  const length = data.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > data.length) throw new RangeError("Borsh string out of bounds");
  return [data.subarray(start, end).toString("utf8"), end];
}

/**
 * Decodes name/symbol/uri from a Metaplex Token Metadata account.
 * Layout: key(u8) | update_authority(32) | mint(32) | name | symbol | uri
 */
export function decodeMetaplexMetadata(data: Buffer): OnchainTokenMetadata | null {
  if (data.length < 1 || data[0] !== METAPLEX_METADATA_V1_KEY) return null;
  try {
    const [name, afterName] = readBorshString(data, 1 + 32 + 32);
    const [symbol, afterSymbol] = readBorshString(data, afterName);
    const [uri] = readBorshString(data, afterSymbol);
    return {
      name: cleanMetadataString(name),
      symbol: cleanMetadataString(symbol),
      uri: cleanMetadataString(uri),
    };
  } catch {
    return null;
  }
}

function hasAnyField(meta: OnchainTokenMetadata | null | undefined): meta is OnchainTokenMetadata {
  return !!meta && !!(meta.name || meta.symbol || meta.uri);
}

/**
 * Reads the Token-2022 in-mint `TokenMetadata` extension.
 * Returns the metadata if stored on the mint itself, otherwise the address the
 * `MetadataPointer` extension points to (if any) so it can be looked up next.
 */
function readToken2022Metadata(
  mint: PublicKey,
  info: AccountInfo<Buffer>,
): { metadata?: OnchainTokenMetadata; pointer?: PublicKey } {
  try {
    const mintState = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
    const tlv = getExtensionData(ExtensionType.TokenMetadata, mintState.tlvData);
    if (tlv) {
      const parsed = unpackTokenMetadata(tlv);
      const metadata = {
        name: cleanMetadataString(parsed.name),
        symbol: cleanMetadataString(parsed.symbol),
        uri: cleanMetadataString(parsed.uri),
      };
      if (hasAnyField(metadata)) return { metadata };
    }
    const pointer = getMetadataPointerState(mintState)?.metadataAddress;
    if (pointer && !pointer.equals(mint)) return { pointer };
  } catch {
    // Malformed extension data - fall through to the Metaplex lookup.
  }
  return {};
}

/**
 * Resolves on-chain metadata for a batch of mints with at most two batched RPC
 * round trips:
 *   1. the mint accounts (Token-2022 in-mint metadata is read directly);
 *   2. the Metaplex metadata PDA, or the Token-2022 `MetadataPointer` target.
 * Mints without metadata are simply absent from the returned map.
 */
export async function fetchOnchainMetadata(
  connection: Connection,
  mints: PublicKey[],
): Promise<Map<string, OnchainTokenMetadata>> {
  const resolved = new Map<string, OnchainTokenMetadata>();
  if (mints.length === 0) return resolved;

  const mintInfos = await getAccountsChunked(connection, mints);

  const lookups: { mint: string; address: PublicKey }[] = [];
  mints.forEach((mint, i) => {
    const info = mintInfos[i];
    if (!info) return;

    if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      const { metadata, pointer } = readToken2022Metadata(mint, info);
      if (metadata) {
        resolved.set(mint.toBase58(), metadata);
        return;
      }
      lookups.push({ mint: mint.toBase58(), address: pointer ?? getMetaplexMetadataAddress(mint) });
    } else if (info.owner.equals(TOKEN_PROGRAM_ID)) {
      lookups.push({ mint: mint.toBase58(), address: getMetaplexMetadataAddress(mint) });
    }
  });

  if (lookups.length === 0) return resolved;

  const metadataInfos = await getAccountsChunked(
    connection,
    lookups.map(l => l.address),
  );
  lookups.forEach(({ mint }, i) => {
    const info = metadataInfos[i];
    if (!info || !info.owner.equals(METAPLEX_TOKEN_METADATA_PROGRAM_ID)) return;
    const metadata = decodeMetaplexMetadata(info.data);
    if (hasAnyField(metadata)) resolved.set(mint, metadata);
  });

  return resolved;
}

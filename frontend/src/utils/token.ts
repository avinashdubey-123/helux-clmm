import { PublicKey, Connection } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import type { TokenMetadata, TokenMetadataRecord } from './tokenMetadata'

export async function findAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, owner)
}

export async function getTokenBalance(connection: Connection, tokenAccount: PublicKey): Promise<number> {
  const res = await connection.getTokenAccountBalance(tokenAccount)
  return Number(res.value.amount)
}

export async function getParsedTokenAccount(connection: Connection, account: PublicKey) {
  return connection.getParsedAccountInfo(account)
}

const NATIVE_SOL_MINTS = new Set([
  '11111111111111111111111111111111',
  'so11111111111111111111111111111111111111112',
])

/** Get a short display name from a token mint address (default when no metadata exists) */
export function getShortTokenName(tokenMint: string): string {
  if (!tokenMint) return 'UNKN'
  if (NATIVE_SOL_MINTS.has(tokenMint.toLowerCase())) return 'SOL'
  // Use first 4 chars for consistency with Portfolio
  return tokenMint.slice(0, 4).toUpperCase()
}

/** Shown in place of a symbol/name while a token's metadata lookup is still running */
export const LOADING_LABEL = '…'

export interface TokenDisplay {
  /** True while the metadata lookup hasn't finished; symbol/iconLabel are then placeholders */
  loading: boolean
  /** Metadata symbol, or the short mint-derived default (placeholder while loading) */
  symbol: string
  /** 2-char label shown inside token icons when there is no image */
  iconLabel: string
  /** Metadata name, only when the token actually has one */
  name?: string
  /** Metadata logo URL, only when the token actually has one */
  image?: string
  /** Label used in pool titles: metadata name when present, otherwise the symbol default */
  poolName: string
  /** Symbol that is never a placeholder: while loading it's the mint-derived default. Use for saved text. */
  settledSymbol: string
}

/**
 * Single source of truth for how a token is displayed.
 * - `meta === undefined`: lookup not finished -> placeholder, no name/symbol shown yet
 * - `meta === null`: lookup finished, no metadata -> existing mint-derived defaults
 * - `meta` present: metadata fields win, defaults fill any missing field
 */
export function getTokenDisplay(tokenMint: string, meta?: TokenMetadata | null): TokenDisplay {
  if (meta === undefined && tokenMint) {
    return {
      loading: true,
      symbol: LOADING_LABEL,
      iconLabel: LOADING_LABEL,
      poolName: LOADING_LABEL,
      settledSymbol: getShortTokenName(tokenMint),
    }
  }
  const symbol = meta?.symbol ?? getShortTokenName(tokenMint)
  return {
    loading: false,
    symbol,
    iconLabel: symbol.slice(0, 2).toUpperCase(),
    name: meta?.name,
    image: meta?.image,
    poolName: meta?.name ?? symbol,
    settledSymbol: symbol,
  }
}

/**
 * Symbol for text that gets saved (e.g. transaction history). Never the loading placeholder:
 * falls back to the default short name if metadata hasn't resolved yet.
 */
export function txSymbol(tokenMint: string, metadata?: TokenMetadataRecord): string {
  return getTokenDisplay(tokenMint, metadata ? metadata[tokenMint] : null).settledSymbol
}

/** Get a display name for a pool from token mints */
export function getPoolDisplayName(token0?: string, token1?: string, metadata?: TokenMetadataRecord): string {
  if (!token0 && !token1) return 'Unknown Pool'
  const name0 = token0 ? getTokenDisplay(token0, metadata ? metadata[token0] : null).poolName : '???'
  const name1 = token1 ? getTokenDisplay(token1, metadata ? metadata[token1] : null).poolName : '???'
  return `${name0} / ${name1}`
}

import { PublicKey, Connection } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

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

/** Get a short display name from a token mint address */
export function getShortTokenName(tokenMint: string): string {
  if (!tokenMint) return 'UNKN'
  // Use first 4 chars for consistency with Portfolio
  return tokenMint.slice(0, 4).toUpperCase()
}

/** Get a display name for a pool from token mints */
export function getPoolDisplayName(token0?: string, token1?: string): string {
  if (!token0 && !token1) return 'Unknown Pool'
  const name0 = token0 ? getShortTokenName(token0) : '???'
  const name1 = token1 ? getShortTokenName(token1) : '???'
  return `${name0} / ${name1}`
}

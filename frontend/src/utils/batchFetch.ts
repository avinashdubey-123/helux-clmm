import { Connection, PublicKey } from '@solana/web3.js'
import { PoolRowData } from '../contexts/PoolsContext'
import { AccountLayout } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { getCachedPoolData, setCachedPoolData } from './cache'

let globalRpcPromise = Promise.resolve()

export const callWithRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    globalRpcPromise = globalRpcPromise.then(async () => {
      let attempt = 0
      while (attempt < maxRetries) {
        try {
          const res = await fn()
          await new Promise(r => setTimeout(r, 100))
          resolve(res)
          return
        } catch (err) {
          attempt++
          const msg = (err as Error)?.message?.toLowerCase() || ''
          if (attempt < maxRetries && (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit'))) {
            const wait = Math.min(500 * Math.pow(2, attempt), 5000) + Math.round(Math.random() * 500)
            await new Promise((r) => setTimeout(r, wait))
            continue
          }
          reject(err)
          return
        }
      }
      reject(new Error('Max retries reached'))
    }).catch(err => {
      // Catch any unexpected errors in the chain so the queue doesn't get permanently stuck
      console.error("[Global RPC Queue] Uncaught error in chain:", err)
    })
  })
}

export const batchFetchPoolData = async (
  connection: Connection,
  pgmId: PublicKey,
  poolsBatch: PoolRowData[]
): Promise<PoolRowData[]> => {
  if (poolsBatch.length === 0) return []

  const cachedResults: PoolRowData[] = []
  const poolsToFetch: PoolRowData[] = []

  for (const pool of poolsBatch) {
    const cached = getCachedPoolData(pool.poolPda)
    if (cached) {
      cachedResults.push(cached)
    } else {
      poolsToFetch.push(pool)
    }
  }

  if (poolsToFetch.length === 0) {
    return cachedResults
  }

  const vaultPubkeys: PublicKey[] = []
  const ammConfigPubkeys = new Set<string>()

  for (const pool of poolsToFetch) {
    if (pool.tokenVault0) vaultPubkeys.push(new PublicKey(pool.tokenVault0))
    if (pool.tokenVault1) vaultPubkeys.push(new PublicKey(pool.tokenVault1))
    if (pool.ammConfig) ammConfigPubkeys.add(pool.ammConfig)
  }

  // Fetch Vaults
  const vaultBalances = new Map<string, number>()
  if (vaultPubkeys.length > 0) {
    try {
      const accs = await callWithRetry(() => connection.getMultipleAccountsInfo(vaultPubkeys))
      accs.forEach((acc, i) => {
        if (acc && acc.data) {
          const decoded = AccountLayout.decode(acc.data)
          vaultBalances.set(vaultPubkeys[i].toBase58(), Number(decoded.amount))
        }
      })
    } catch (err) {
      console.error('[batchFetch] Vault fetch error', err)
    }
  }

  // Fetch AMM Configs
  const ammConfigFees = new Map<string, number>()
  const ammConfigArray = Array.from(ammConfigPubkeys).map(p => new PublicKey(p))
  if (ammConfigArray.length > 0) {
    try {
      const accs = await callWithRetry(() => connection.getMultipleAccountsInfo(ammConfigArray))
      accs.forEach((acc, i) => {
        if (acc && acc.data && acc.data.length >= 51) {
          const tradeFeeRate = acc.data.readUInt32LE(47)
          ammConfigFees.set(ammConfigArray[i].toBase58(), tradeFeeRate)
        }
      })
    } catch (err) {
      console.error('[batchFetch] AMM Config fetch error', err)
    }
  }

  // Fetch Active Liquidity (Sequential to avoid 429)
  const enrichedPools = poolsToFetch.map(p => ({ ...p }))
  
  for (const pool of enrichedPools) {
    try {
      const personalPositions = await callWithRetry(() => connection.getProgramAccounts(pgmId, {
        filters: [{ memcmp: { offset: 41, bytes: pool.poolPda } }],
        encoding: 'base64',
        dataSlice: { offset: 0, length: 97 }
      }))

      const sqrtP = Number(pool.sqrtPriceX64) / Math.pow(2, 64)
      const tickCurrent = pool.tickCurrent
      let amount0Raw = 0
      let amount1Raw = 0

      for (const p of personalPositions) {
        const data = p.account.data
        if (data.length < 97) continue
        const tickLower = data.readInt32LE(73)
        const tickUpper = data.readInt32LE(77)
        const L_bn = new BN(data.subarray(81, 97), 'le')
        if (L_bn.isZero()) continue
        const L_pos = Number(L_bn.toString())
        const sqrt_a = Math.pow(1.0001, tickLower / 2)
        const sqrt_b = Math.pow(1.0001, tickUpper / 2)

        if (tickLower <= tickCurrent && tickUpper > tickCurrent) {
          amount1Raw += L_pos * (sqrtP - sqrt_a)
          amount0Raw += L_pos * ( (1 / sqrtP) - (1 / sqrt_b) )
        }
      }

      pool.activeLiquidity0 = amount0Raw / Math.pow(10, pool.mintDecimals0)
      pool.activeLiquidity1 = amount1Raw / Math.pow(10, pool.mintDecimals1)
    } catch (e) {
      console.warn(`[batchFetch] Active liquidity fetch failed for pool ${pool.poolPda}`, e)
    }

    if (pool.tokenVault0 && vaultBalances.has(pool.tokenVault0)) {
      pool.vault0Balance = vaultBalances.get(pool.tokenVault0)! / Math.pow(10, pool.mintDecimals0)
    }
    if (pool.tokenVault1 && vaultBalances.has(pool.tokenVault1)) {
      pool.vault1Balance = vaultBalances.get(pool.tokenVault1)! / Math.pow(10, pool.mintDecimals1)
    }

    if (pool.ammConfig && ammConfigFees.has(pool.ammConfig)) {
      pool.tradeFeeRate = ammConfigFees.get(pool.ammConfig)
    }

    pool.isActiveLiquidityLoading = false
    setCachedPoolData(pool.poolPda, pool)
  }

  // Re-assemble the original order
  const finalResults: PoolRowData[] = []
  for (const pool of poolsBatch) {
    const cached = getCachedPoolData(pool.poolPda)
    if (cached) {
      finalResults.push(cached)
    }
  }

  return finalResults
}

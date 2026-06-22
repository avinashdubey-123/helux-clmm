import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useConnection } from '@solana/wallet-adapter-react'
import useProgram from '../utils/useProgram'

export type PoolRowData = {
  poolPda: string
  ammConfig: string
  tokenMint0: string
  tokenMint1: string
  tokenVault0: string
  tokenVault1: string
  mintDecimals0: number
  mintDecimals1: number
  tickSpacing: number
  tickCurrent: number
  liquidity: string
  sqrtPriceX64: string
  protocolFeesToken0: string
  protocolFeesToken1: string
  apr?: string
  vault0Balance?: number | null
  vault1Balance?: number | null
  tradeFeeRate?: number
  activeLiquidity0?: number | null
  activeLiquidity1?: number | null
  isActiveLiquidityLoading?: boolean
}

const toBase58 = (value: any) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value?.toBase58) return value.toBase58()
  if (value?.toString) return value.toString()
  return null
}

const toNumber = (value: any, fallback = 0) => {
  if (value == null) return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const numeric = Number(value.toString?.() ?? value)
  return Number.isFinite(numeric) ? numeric : fallback
}

interface PoolsContextType {
  pools: PoolRowData[]
  loadingPools: boolean
  poolsError: string | null
  refreshPools: () => void
}

const PoolsContext = createContext<PoolsContextType>({
  pools: [],
  loadingPools: false,
  poolsError: null,
  refreshPools: () => { },
})

export const usePools = () => useContext(PoolsContext)

const callWithRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  let attempt = 0
  while (attempt < maxRetries) {
    try {
      return await fn()
    } catch (err: any) {
      attempt++
      const msg = err?.message?.toLowerCase() || ''
      if (attempt < maxRetries && (msg.includes('429') || msg.includes('too many requests'))) {
        const wait = Math.min(500 * Math.pow(2, attempt), 5000) + Math.round(Math.random() * 500)
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries reached')
}

export const PoolsProvider = ({ children }: { children: ReactNode }) => {
  const program = useProgram()
  const { connection } = useConnection()

  const [pools, setPools] = useState<PoolRowData[]>([])
  const [loadingPools, setLoadingPools] = useState(false)
  const [poolsError, setPoolsError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const refreshPools = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  useEffect(() => {
    let cancelled = false

    const loadPools = async () => {
      if (!program) {
        if (!cancelled) {
          setPools([])
          setPoolsError('Connect a wallet to load pools.')
        }
        return
      }

      setLoadingPools(true)
      setPoolsError(null)

      try {
        const rawPools = await (program.account as any).poolState.all()
        
        // 1. Gather all unique vault pubkeys and amm config pubkeys
        const vaultPubkeys: PublicKey[] = []
        const ammConfigPubkeys = new Set<string>()

        for (const entry of rawPools) {
          const account = entry.account ?? {}
          const tokenVault0 = account.tokenVault0 ?? account.token_vault_0
          const tokenVault1 = account.tokenVault1 ?? account.token_vault_1
          const ammCfg = account.ammConfig ?? account.amm_config
          if (tokenVault0) vaultPubkeys.push(new PublicKey(tokenVault0))
          if (tokenVault1) vaultPubkeys.push(new PublicKey(tokenVault1))
          if (ammCfg) ammConfigPubkeys.add(toBase58(ammCfg)!)
        }

        // 2. Fetch all vaults in batched chunks of 100 (Solana RPC limit for getMultipleAccountsInfo)
        const vaultBalances = new Map<string, number>()
        // We import AccountLayout here to avoid touching top-level imports if spl-token isn't loaded yet
        const { AccountLayout } = await import('@solana/spl-token')

        for (let i = 0; i < vaultPubkeys.length; i += 100) {
          if (cancelled) break
          const chunk = vaultPubkeys.slice(i, i + 100)
          const accountsInfo = await connection.getMultipleAccountsInfo(chunk)
          accountsInfo.forEach((acc, index) => {
            if (acc && acc.data) {
              const decoded = AccountLayout.decode(acc.data)
              vaultBalances.set(chunk[index].toBase58(), Number(decoded.amount))
            }
          })
        }

        // 2b. Fetch AMM configs to get tradeFeeRate
        const ammConfigFees = new Map<string, number>()
        const ammConfigArray = Array.from(ammConfigPubkeys)
        for (let i = 0; i < ammConfigArray.length; i += 100) {
          if (cancelled) break
          const chunk = ammConfigArray.slice(i, i + 100).map(p => new PublicKey(p))
          const accountsInfo = await connection.getMultipleAccountsInfo(chunk)
          accountsInfo.forEach((acc, index) => {
            if (acc && acc.data && acc.data.length >= 51) {
              // Read trade_fee_rate u32 at offset 47
              const tradeFeeRate = acc.data.readUInt32LE(47)
              ammConfigFees.set(ammConfigArray[i + index], tradeFeeRate)
            }
          })
        }

        // 3. Map the pools with the pre-fetched balances
        const mappedPools: PoolRowData[] = rawPools.map((entry: any) => {
          const account = entry.account ?? {}
          const tokenVault0 = toBase58(account.tokenVault0 ?? account.token_vault_0)
          const tokenVault1 = toBase58(account.tokenVault1 ?? account.token_vault_1)
          const dec0 = toNumber(account.mintDecimals0 ?? account.mint_decimals_0, 6)
          const dec1 = toNumber(account.mintDecimals1 ?? account.mint_decimals_1, 6)

          let vault0Balance: number | null = null
          let vault1Balance: number | null = null

          if (tokenVault0 && vaultBalances.has(tokenVault0)) {
            vault0Balance = vaultBalances.get(tokenVault0)! / Math.pow(10, dec0)
          }
          if (tokenVault1 && vaultBalances.has(tokenVault1)) {
            vault1Balance = vaultBalances.get(tokenVault1)! / Math.pow(10, dec1)
          }

          return {
            poolPda: entry.publicKey.toBase58(),
            ammConfig: toBase58(account.ammConfig ?? account.amm_config) ?? '',
            tokenMint0: toBase58(account.tokenMint0 ?? account.token_mint_0) ?? '',
            tokenMint1: toBase58(account.tokenMint1 ?? account.token_mint_1) ?? '',
            tokenVault0: tokenVault0 ?? '',
            tokenVault1: tokenVault1 ?? '',
            mintDecimals0: dec0,
            mintDecimals1: dec1,
            tickSpacing: toNumber(account.tickSpacing ?? account.tick_spacing, 1),
            tickCurrent: toNumber(account.tickCurrent ?? account.tick_current, 0),
            liquidity: String(account.liquidity?.toString?.() ?? account.liquidity ?? '0'),
            sqrtPriceX64: String(account.sqrtPriceX64?.toString?.() ?? account.sqrt_price_x64 ?? '0'),
            protocolFeesToken0: String(account.protocolFeesToken0?.toString?.() ?? account.protocol_fees_token_0 ?? '0'),
            protocolFeesToken1: String(account.protocolFeesToken1?.toString?.() ?? account.protocol_fees_token_1 ?? '0'),
            vault0Balance,
            vault1Balance,
            tradeFeeRate: ammConfigFees.get(toBase58(account.ammConfig ?? account.amm_config) ?? ''),
            isActiveLiquidityLoading: true,
          }
        })

        if (!cancelled) {
          setPools(mappedPools)
          
          // --- Background Trickle for Active Liquidity ---
          // Fetch active liquidity in background chunks of 5
          const fetchActiveLiquidityBackground = async () => {
            let currentPools = [...mappedPools]
            
            const { BN } = await import('@coral-xyz/anchor')
            const pgmId = program ? (program as any).programId : new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")

            // Process pools in chunks to speed up loading without hitting rate limits
            const CHUNK_SIZE = 5;
            for (let i = 0; i < currentPools.length; i += CHUNK_SIZE) {
              if (cancelled) break

              const chunk = currentPools.slice(i, i + CHUNK_SIZE)
              
              await Promise.all(chunk.map(async (pool) => {
                try {
                  const personalPositions = await callWithRetry(() => connection.getProgramAccounts(pgmId, {
                    filters: [
                      { memcmp: { offset: 41, bytes: pool.poolPda } }
                    ]
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

                    const liquidityBuf = data.subarray(81, 97)
                    const L_bn = new BN(liquidityBuf, 'le')
                    if (L_bn.isZero()) continue

                    const L_pos = Number(L_bn.toString())

                    const sqrt_a = Math.pow(1.0001, tickLower / 2)
                    const sqrt_b = Math.pow(1.0001, tickUpper / 2)

                    if (tickLower <= tickCurrent && tickUpper > tickCurrent) {
                      amount1Raw += L_pos * (sqrtP - sqrt_a)
                      amount0Raw += L_pos * ( (1 / sqrtP) - (1 / sqrt_b) )
                    }
                  }

                  const active0 = amount0Raw / Math.pow(10, pool.mintDecimals0)
                  const active1 = amount1Raw / Math.pow(10, pool.mintDecimals1)

                  const poolIndex = currentPools.findIndex(p => p.poolPda === pool.poolPda)
                  if (poolIndex !== -1) {
                    currentPools[poolIndex] = {
                      ...pool,
                      activeLiquidity0: active0,
                      activeLiquidity1: active1,
                      isActiveLiquidityLoading: false
                    }
                  }

                } catch (e) {
                  console.error(`Failed to fetch active liquidity for ${pool.poolPda}`, e)
                  const poolIndex = currentPools.findIndex(p => p.poolPda === pool.poolPda)
                  if (poolIndex !== -1) {
                    currentPools[poolIndex] = {
                      ...pool,
                      isActiveLiquidityLoading: false
                    }
                  }
                }
              }))

              if (cancelled) break
              
              // Flush UI immediately after EACH chunk completes
              setPools([...currentPools])

              // Delay between chunks to respect rate limits
              await new Promise(resolve => setTimeout(resolve, 500))
            }
          }

          // Fire and forget
          fetchActiveLiquidityBackground().catch(console.error)
        }
      } catch (error: any) {
        if (!cancelled) {
          setPools([])
          setPoolsError(error?.message || 'Failed to fetch pools')
        }
      } finally {
        if (!cancelled) setLoadingPools(false)
      }
    }

    loadPools()

    return () => {
      cancelled = true
    }
  }, [program, connection, refreshTrigger])

  return (
    <PoolsContext.Provider value={{ pools, loadingPools, poolsError, refreshPools }}>
      {children}
    </PoolsContext.Provider>
  )
}

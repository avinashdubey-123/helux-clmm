import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BN } from '@coral-xyz/anchor'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid
} from 'recharts'
import { getPositionAddress, getTickArrayAddress } from '../../utils/pda'
import { useTransactions } from '../../contexts/TxContext'
import useProgram from '../../utils/useProgram'
import TransactionCard from '../../components/TransactionCard/TransactionCard'
import copyIcon from '../../assets/copy.svg'
import { usePools } from '../../contexts/PoolsContext'
import './DepositForm.css'
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
const MIN_TICK = -443636
const MAX_TICK = 443636
const clampTick = (tick: number, spacing: number, direction: 'down' | 'up') => {
  const safeSpacing = Math.max(1, spacing)
  const snapped = direction === 'down'
    ? Math.floor(tick / safeSpacing) * safeSpacing
    : Math.ceil(tick / safeSpacing) * safeSpacing
  return Math.max(MIN_TICK, Math.min(MAX_TICK, snapped))
}
const snapTickToSpacing = (tick: number, spacing: number) => {
  const safeSpacing = Math.max(1, spacing)
  const snapped = Math.round(tick / safeSpacing) * safeSpacing
  return Math.max(MIN_TICK, Math.min(MAX_TICK, snapped))
}
const tickArrayStartIndex = (tick: number, spacing: number) => {
  const tickCount = 60 * Math.max(1, spacing)
  return Math.floor(tick / tickCount) * tickCount
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toPublicKey = (value?: string | any | null) => {
  if (!value) return null
  if (value instanceof PublicKey) return value
  try {
    return new PublicKey(typeof value === 'string' ? value : value.toString())
  } catch {
    return null
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toNumber = (value: any, fallback = 0) => {
  const numeric = Number(value?.toString?.() ?? value ?? fallback)
  return Number.isFinite(numeric) ? numeric : fallback
}
const formatAmount = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return value.toFixed(6).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1')
}
const sqrtPriceX64ToTick = (sqrtPriceX64: number) => {
  if (!Number.isFinite(sqrtPriceX64) || sqrtPriceX64 <= 0) return 0
  const q64 = 2 ** 64
  const ratio = (sqrtPriceX64 / q64) ** 2
  return Math.log(ratio) / Math.log(1.0001)
}
/** Deterministic colour from a public-key string */
const addressToColor = (addr: string) => {
  const hash = addr.split('').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0)
  const hue = hash % 360
  return `hsl(${hue},70%,58%)`
}
/** TICK_ARRAY_SIZE from on-chain: each TickArrayState holds 60 ticks */
const TICK_ARRAY_SIZE = 60
/**
 * TickState on-chain layout (zero-copy, C-packed):
 *   tick:               i32    (4 bytes)
 *   liquidity_net:      i128   (16 bytes)
 *   liquidity_gross:    u128   (16 bytes)
 *   ... remaining fields we don't need
 * Total per TickState = 168 bytes
 *
 * TickArrayState layout:
 *   discriminator:      8 bytes
 *   pool_id:            32 bytes (Pubkey)
 *   start_tick_index:   4 bytes (i32)
 *   ticks:              60 * 168 bytes
 *   ...
 */
const TICK_STATE_SIZE = 168
const TICK_ARRAY_HEADER = 8 + 32 + 4 // discriminator + pool_id + start_tick_index
/** Read a signed 32-bit int from a Uint8Array at offset (little-endian) */
const readI32LE = (buf: Uint8Array, offset: number): number => {
  return (buf[offset] | (buf[offset+1] << 8) | (buf[offset+2] << 16) | (buf[offset+3] << 24))
}
/** Read a signed 128-bit int from a Uint8Array at offset (LE) as JS number.
 *  Uses manual byte reading to avoid DataView alignment issues. */
const readI128AsNumber = (buf: Uint8Array, offset: number): number => {
  let lo = 0n
  for (let i = 7; i >= 0; i--) lo = (lo << 8n) | BigInt(buf[offset + i])
  let hi = 0n
  for (let i = 7; i >= 0; i--) hi = (hi << 8n) | BigInt(buf[offset + 8 + i])
  let val = lo | (hi << 64n)
  if (buf[offset + 15] & 0x80) val = val - (1n << 128n)
  return Number(val)
}
/** Read an unsigned 128-bit int from a Uint8Array at offset (LE) as JS number. */
const readU128AsNumber = (buf: Uint8Array, offset: number): number => {
  let lo = 0n
  for (let i = 7; i >= 0; i--) lo = (lo << 8n) | BigInt(buf[offset + i])
  let hi = 0n
  for (let i = 7; i >= 0; i--) hi = (hi << 8n) | BigInt(buf[offset + 8 + i])
  return Number(lo | (hi << 64n))
}
/**
 * Fetch real on-chain liquidity from TickArrayState accounts.
 * Manually parses zero-copy (C-packed) account data.
 * Returns { tick, price, liquidity }[] — a stepped cumulative liquidity profile.
 */
const fetchOnChainLiquidity = async (
  connection: import('@solana/web3.js').Connection,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: any,
  poolPda: PublicKey,
  priceTick: number,
  tickSpacing: number,
  decimals0: number,
  decimals1: number,
  priceOrientation: 'token1PerToken0' | 'token0PerToken1',
  poolLiquidity: number
): Promise<{ tick: number; price: number; liquidity: number }[]> => {
  const tickCount = TICK_ARRAY_SIZE * Math.max(1, tickSpacing)
  const coverageArrays = 5 // fetch 5 arrays on each side + current = up to 11 arrays
  // Compute the start indices of tick arrays covering a wide range around priceTick
  const centerStart = Math.floor(priceTick / tickCount) * tickCount
  const startIndices: number[] = []
  for (let i = -coverageArrays; i <= coverageArrays; i++) {
    const idx = centerStart + i * tickCount
    if (idx >= MIN_TICK && idx <= MAX_TICK) startIndices.push(idx)
  }
  // Derive PDA addresses for each tick array
  const pdas = startIndices.map(idx => getTickArrayAddress(poolPda, idx, program.programId)[0])
  try {
    const accounts = await connection.getMultipleAccountsInfo(pdas)
    const tickEntries: { tick: number; liquidityNet: number }[] = []
    let existingCount = 0
    for (let arrIdx = 0; arrIdx < accounts.length; arrIdx++) {
      const acct = accounts[arrIdx]
      if (!acct?.data) continue
      existingCount++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buf: Uint8Array = acct.data instanceof Uint8Array ? acct.data : new Uint8Array(acct.data as any)
      const expectedSize = TICK_ARRAY_HEADER + TICK_ARRAY_SIZE * TICK_STATE_SIZE
      if (buf.length < expectedSize) {
        console.warn(`[CLMM] TickArray #${arrIdx} (start=${startIndices[arrIdx]}) too small: ${buf.length} < ${expectedSize}`)
        continue
      }
      for (let j = 0; j < TICK_ARRAY_SIZE; j++) {
        const tickOffset = TICK_ARRAY_HEADER + j * TICK_STATE_SIZE
        // Read liquidity_gross (u128 at offset +20 within TickState) to check if initialized
        const liquidityGross = readU128AsNumber(buf, tickOffset + 20)
        if (liquidityGross === 0) continue // tick not initialized
        const tick = readI32LE(buf, tickOffset)
        const liquidityNet = readI128AsNumber(buf, tickOffset + 4)
        tickEntries.push({ tick, liquidityNet })
      }
    }
    console.log(`[CLMM] Fetched ${pdas.length} tick array PDAs, ${existingCount} exist on-chain, ${tickEntries.length} initialized ticks found`)
    if (tickEntries.length === 0) {
      // If no ticks are found, provide a flat zero-liquidity line spanning a reasonable
      // range around the current price so the chart renders properly and handles are visible.
      const halfSpan = tickSpacing * 14
      const data: { tick: number; price: number; liquidity: number }[] = []
      for (const t of [priceTick - halfSpan, priceTick, priceTick + halfSpan]) {
        const raw = Math.pow(1.0001, t) * Math.pow(10, decimals0 - decimals1)
        const price = priceOrientation === 'token1PerToken0' ? raw : (raw > 0 ? 1 / raw : 0)
        data.push({ tick: t, price: parseFloat(price.toFixed(8)), liquidity: 0 })
      }
      return data
    }
    // Sort by tick to prepare for traversal
    tickEntries.sort((a, b) => a.tick - b.tick)
    // Helper to compute active liquidity at any given tick by traversing from currentTick
    const getLiquidityAtTick = (targetTick: number): number => {
      let L = poolLiquidity
      if (targetTick > priceTick) {
        for (const entry of tickEntries) {
          if (entry.tick > priceTick && entry.tick <= targetTick) L += entry.liquidityNet
        }
      } else if (targetTick < priceTick) {
        for (const entry of tickEntries) {
          if (entry.tick <= priceTick && entry.tick > targetTick) L -= entry.liquidityNet
        }
      }
      return Math.max(0, L)
    }
    const data: { tick: number; price: number; liquidity: number; normalizedLiquidity?: number }[] = []
    const firstTick = Math.min(tickEntries[0].tick, priceTick - tickSpacing * 14)
    const lastTick = Math.max(tickEntries[tickEntries.length - 1].tick, priceTick + tickSpacing * 14)
    // Sample ticks across the visible range
    for (let t = firstTick - tickSpacing * 4; t <= lastTick + tickSpacing * 4; t += tickSpacing) {
      const L = getLiquidityAtTick(t)
      // Convert raw on-chain liquidity integer to client-side UI value
      const depth = L / Math.pow(10, (decimals0 + decimals1) / 2)
      // Formatted price for X-axis display
      const raw = Math.pow(1.0001, t) * Math.pow(10, decimals0 - decimals1)
      const price = priceOrientation === 'token1PerToken0' ? raw : (raw > 0 ? 1 / raw : 0)
      data.push({
        tick: t,
        price: parseFloat(price.toFixed(8)),
        liquidity: depth > 0 ? depth : 0,
        normalizedLiquidity: depth > 0 ? depth : 0,
      })
    }
    // Sort by price ascending because Recharts AreaChart requires X-axis data to be strictly increasing!
    data.sort((a, b) => a.price - b.price)
    // Normalize liquidity values to a 0-100 scale for the Y-axis projection
    const maxL = Math.max(...data.map(d => d.liquidity))
    if (maxL > 0) {
      data.forEach(d => {
        d.normalizedLiquidity = Number(((d.liquidity / maxL) * 100).toFixed(2))
      })
    }
    console.log(`[CLMM] Liquidity chart data: ${data.length} points`)
    return data
  } catch (err) {
    console.error('[CLMM] Failed to fetch tick arrays:', err)
    return []
  }
}
/** Inline token badge: sphere + name (up to 4 chars) side by side */
function TokenBadge({ mint, name, color }: { mint: PublicKey | null; name: string; color: string }) {
  const label = mint ? mint.toBase58().slice(0, 2).toUpperCase() : name.slice(0, 2).toUpperCase()
  const displayName = name.slice(0, 4)
  return (
    <span className="df-token-badge">
      <span className="df-sphere" style={{ background: color }} title={mint?.toBase58()}>
        {label}
      </span>
      <span className="df-token-name">{displayName}</span>
    </span>
  )
}
/** NFT minted overlay */
function NftOverlay({
  mintAddress,
  positionAddress,
  onClose,
}: {
  mintAddress: string
  positionAddress: string
  onClose: () => void
}) {
  const explorerUrl = `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`
  return (
    <div className="nft-overlay" role="dialog" aria-modal="true" aria-label="Position NFT minted">
      <div className="nft-overlay-backdrop" onClick={onClose} />
      <div className="nft-overlay-card">
        <button className="nft-overlay-close" onClick={onClose} aria-label="Close NFT overlay">✕</button>
        <div className="nft-overlay-glow" />
        <div className="nft-overlay-icon">🎉</div>
        <h2 className="nft-overlay-title">Position NFT Minted!</h2>
        <p className="nft-overlay-subtitle">Your liquidity position NFT has been minted and sent to your wallet.</p>
        <div className="nft-overlay-detail">
          <span className="nft-detail-label">NFT Mint</span>
          <span className="nft-detail-value">{mintAddress.slice(0, 8)}…{mintAddress.slice(-8)}</span>
        </div>
        <div className="nft-overlay-detail">
          <span className="nft-detail-label">Position Account</span>
          <span className="nft-detail-value">{positionAddress.slice(0, 8)}…{positionAddress.slice(-8)}</span>
        </div>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="nft-overlay-explorer-btn"
          id="nft-explorer-link"
        >
          View on Solana Explorer ↗
        </a>
        <button className="nft-overlay-dismiss" onClick={onClose} id="nft-dismiss-btn">
          Close
        </button>
      </div>
    </div>
  )
}
// ── Custom Recharts tooltip ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LiquidityTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const { price, liquidity } = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-row">
        <span>Price</span>
        <strong>{formatAmount(price)}</strong>
      </div>
      <div className="chart-tooltip-row">
        <span>Liquidity</span>
        <strong>{liquidity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
      </div>
    </div>
  )
}
export default function DepositForm() {
  const location = useLocation()
  const { refreshPools } = usePools()
  const program = useProgram()
  const { connection } = useConnection()
  const wallet = useWallet()
  const chartRef = useRef<HTMLDivElement | null>(null)
  const { addTransaction } = useTransactions()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = location.state as { pool?: any; poolPda?: string } | null
  const poolPda = useMemo(() => toPublicKey(state?.pool?.poolPda ?? state?.poolPda), [state?.pool?.poolPda, state?.poolPda])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pool, setPool] = useState<any>(state?.pool ?? null)
  const [activeField, setActiveField] = useState<'amount0' | 'amount1'>('amount0')
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [tickLower, setTickLower] = useState('0')
  const [tickUpper, setTickUpper] = useState('0')
  const [draggingHandle, setDraggingHandle] = useState<'lower' | 'upper' | null>(null)
  const [activePill, setActivePill] = useState<string | null>(null)
  const [priceOrientation, setPriceOrientation] = useState<'token1PerToken0' | 'token0PerToken1'>('token1PerToken0')
  const [feeTierLabel, setFeeTierLabel] = useState('')
  const [minPriceInput, setMinPriceInput] = useState('')
  const [maxPriceInput, setMaxPriceInput] = useState('')
  const [slippageTolerance, setSlippageTolerance] = useState<1.01 | 1.025 | 1.035>(1.01)
  const [showSlippageOverlay, setShowSlippageOverlay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [txState, setTxState] = useState<{
    status: 'success' | 'error' | 'info'
    title: string
    message: string
    signature?: string
    details?: string | null
  } | null>(null)
  const [poolHoverVisible, setPoolHoverVisible] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const hoverTimeoutRef = useRef<number | null>(null)
  // NFT overlay state
  const [nftOverlay, setNftOverlay] = useState<{
    mintAddress: string
    positionAddress: string
  } | null>(null)
  // Trigger to reload on-chain data after deposit
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const handleToggleOrientation = () => {
    setPriceOrientation(prev => (prev === 'token1PerToken0' ? 'token0PerToken1' : 'token1PerToken0'))
  }
  const showPoolHover = () => {
    if (hoverTimeoutRef.current != null) { window.clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null }
    setPoolHoverVisible(true)
  }
  const hidePoolHover = () => {
    if (hoverTimeoutRef.current != null) { window.clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null }
    hoverTimeoutRef.current = window.setTimeout(() => setPoolHoverVisible(false), 150)
  }
  const copyText = async (value: string | null | undefined, key: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      // ignore
    }
  }
  useEffect(() => {
    let cancelled = false
    const loadPool = async () => {
      if (!program || !poolPda) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const freshPool = await (program.account as any).poolState.fetch(poolPda)
        if (!cancelled) {
          setPool({ ...freshPool, poolPda: poolPda.toBase58() })
        }
        const ammConfigPda = freshPool.ammConfig ?? freshPool.amm_config
        if (ammConfigPda) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = await (program.account as any).ammConfig.fetch(ammConfigPda)
          const tradeFeeRate = Number(config.tradeFeeRate?.toString?.() ?? config.trade_fee_rate?.toString?.() ?? 0)
          const val = tradeFeeRate > 100 ? tradeFeeRate / 10000 : tradeFeeRate
          if (!cancelled) setFeeTierLabel(`${val}%`)
        }
      } catch {
        if (!cancelled) setPool(state?.pool ?? null)
      }
    }
    loadPool()
    return () => { cancelled = true }
  }, [program, poolPda, refreshTrigger])
  const tokenMint0 = toPublicKey(pool?.tokenMint0 ?? pool?.token_mint_0)
  const tokenMint1 = toPublicKey(pool?.tokenMint1 ?? pool?.token_mint_1)
  const tokenVault0 = toPublicKey(pool?.tokenVault0 ?? pool?.token_vault_0)
  const tokenVault1 = toPublicKey(pool?.tokenVault1 ?? pool?.token_vault_1)
  const tickSpacing = Math.max(1, toNumber(pool?.tickSpacing ?? pool?.tick_spacing, 1))
  const decimals0 = toNumber(pool?.mintDecimals0 ?? pool?.mint_decimals_0, 6)
  const decimals1 = toNumber(pool?.mintDecimals1 ?? pool?.mint_decimals_1, 6)
  const currentTick = toNumber(pool?.tickCurrent ?? pool?.tick_current, 0)
  const sqrtPriceX64 = toNumber(pool?.sqrtPriceX64 ?? pool?.sqrt_price_x64, 0)
  // ── Token labels (2 chars for sphere, 4 chars for name) ──
  const token0Label = tokenMint0 ? tokenMint0.toBase58().slice(0, 2).toUpperCase() : 'T0'
  const token1Label = tokenMint1 ? tokenMint1.toBase58().slice(0, 2).toUpperCase() : 'T1'
  const token0Name = tokenMint0 ? tokenMint0.toBase58().slice(0, 4).toUpperCase() : 'TK0'
  const token1Name = tokenMint1 ? tokenMint1.toBase58().slice(0, 4).toUpperCase() : 'TK1'
  const formattedPool = useMemo(() => token0Name && token1Name ? `${token0Name}/${token1Name}` : '', [token0Name, token1Name])
  
  // Fetch user balances
  const [balance0, setBalance0] = useState<number>(0)
  const [balance1, setBalance1] = useState<number>(0)

  useEffect(() => {
    if (!wallet.publicKey || !tokenMint0 || !tokenMint1) return
    let active = true

    const getBalances = async () => {
      try {
        const bal0 = await connection.getParsedTokenAccountsByOwner(wallet.publicKey!, { mint: tokenMint0! })
        const bal1 = await connection.getParsedTokenAccountsByOwner(wallet.publicKey!, { mint: tokenMint1! })
        
        let b0 = 0
        let b1 = 0
        if (bal0.value.length > 0) b0 = bal0.value[0].account.data.parsed.info.tokenAmount.uiAmount
        if (bal1.value.length > 0) b1 = bal1.value[0].account.data.parsed.info.tokenAmount.uiAmount
        
        if (active) {
          setBalance0(b0)
          setBalance1(b1)
        }
      } catch (err) {}
    }
    getBalances()
    return () => { active = false }
  }, [wallet.publicKey, connection, tokenMint0, tokenMint1, refreshTrigger])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const token0Color = useMemo(() => tokenMint0 ? addressToColor(tokenMint0.toBase58()) : 'hsl(200,70%,58%)', [tokenMint0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const token1Color = useMemo(() => tokenMint1 ? addressToColor(tokenMint1.toBase58()) : 'hsl(270,70%,58%)', [tokenMint1])
  const poolTickEstimate = sqrtPriceX64 > 0 ? sqrtPriceX64ToTick(sqrtPriceX64) : currentTick
  // BUG FIX: Always prefer the exact tick from the on-chain pool over JS math estimation
  const priceTick = currentTick !== 0 ? currentTick : (Number.isFinite(poolTickEstimate) ? Math.round(poolTickEstimate) : 0)
  const baseRatio = sqrtPriceX64 > 0
    ? (Math.pow(1.0001, priceTick) * Math.pow(10, decimals0 - decimals1))
    : 1
  // Label: "X token1 / token0" means X of token1 per 1 of token0
  const displayBaseLabel = priceOrientation === 'token1PerToken0'
    ? `${token1Name} / ${token0Name}`
    : `${token0Name} / ${token1Name}`
  const depositTotal = (Number(amount0) || 0) + (Number(amount1) || 0)
  // ── Chart range helpers ──
  const selectedLowerTick = snapTickToSpacing(Number(tickLower) || priceTick, tickSpacing)
  const selectedUpperTick = snapTickToSpacing(Number(tickUpper) || priceTick, tickSpacing)
  const rangeIsInvalid = selectedLowerTick >= selectedUpperTick
  // BUG 3 FIX: Determine deposit mode based on current tick vs selected range
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const depositMode: 'token0Only' | 'token1Only' | 'both' = useMemo(() => {
    if (priceTick < selectedLowerTick) return 'token0Only'
    if (priceTick >= selectedUpperTick) return 'token1Only'
    return 'both'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceTick, selectedLowerTick, selectedUpperTick])
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const depositRatio = useMemo(() => {
    const a0 = Number(amount0) || 0
    const a1 = Number(amount1) || 0
    // Compute value using the baseRatio (token1 per token0)
    const value0 = a0 * (Number.isFinite(baseRatio) && baseRatio > 0 ? baseRatio : 1)
    const value1 = a1
    const totalValue = value0 + value1
    // Single-sided: 100/0 or 0/100
    if (depositMode === 'token0Only' || (totalValue > 0 && value0 > 0 && value1 === 0)) {
      return `100% ${token0Name} / 0% ${token1Name}`
    }
    if (depositMode === 'token1Only' || (totalValue > 0 && value1 > 0 && value0 === 0)) {
      return `0% ${token0Name} / 100% ${token1Name}`
    }
    // Both sides: compute percentage split from actual value
    if (totalValue > 0) {
      const pct0 = Math.round((value0 / totalValue) * 100)
      const pct1 = 100 - pct0
      return `${pct0}% ${token0Name} / ${pct1}% ${token1Name}`
    }
    return `0% ${token0Name} / 0% ${token1Name}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount0, amount1, baseRatio, depositMode, token0Name, token1Name])
  const tickToPrice = (tick: number) => {
    const underlyingRatio = Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1)
    return priceOrientation === 'token1PerToken0'
      ? underlyingRatio
      : (underlyingRatio > 0 ? 1 / underlyingRatio : 0)
  }
  const displayPriceToTick = (displayPrice: number) => {
    if (!Number.isFinite(displayPrice) || displayPrice <= 0) return 0
    const underlyingRatio = priceOrientation === 'token1PerToken0' ? displayPrice : 1 / displayPrice
    const tickRatio = underlyingRatio / Math.pow(10, decimals0 - decimals1)
    return Math.log(tickRatio) / Math.log(1.0001)
  }
  // ── Recharts data — real on-chain liquidity ──
  const [liquidityData, setLiquidityData] = useState<{ tick: number; price: number; liquidity: number }[]>([])
  const [zoomLevel, setZoomLevel] = useState(1)
  useEffect(() => {
    if (!program || !poolPda || !connection) return
    let cancelled = false
    fetchOnChainLiquidity(connection, program, poolPda, priceTick, tickSpacing, decimals0, decimals1, priceOrientation, Number(pool?.liquidity?.toString?.() ?? pool?.liquidity ?? 0))
      .then(data => {
        if (!cancelled) setLiquidityData(data)
      })
      .catch((err) => {
        console.warn('[CLMM] On-chain fetch failed', err)
        if (!cancelled) setLiquidityData([])
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, poolPda, priceTick, tickSpacing, decimals0, decimals1, priceOrientation, connection, refreshTrigger])
  const currentPrice = tickToPrice(priceTick)
  const lowerPrice = tickToPrice(selectedLowerTick)
  const upperPrice = tickToPrice(selectedUpperTick)
  const chartDomain = useMemo(() => {
    if (liquidityData.length === 0) return ['dataMin', 'dataMax']
    const prices = liquidityData.map(d => d.price)
    // BUG FIX: The chart must visually span far enough to show the selected pointers even if they are outside the fetched liquidity bins
    const minP = Math.min(...prices, lowerPrice)
    const maxP = Math.max(...prices, upperPrice)
    const maxDist = Math.max(Math.abs(currentPrice - minP), Math.abs(maxP - currentPrice))
    
    // BUG FIX: Add 25% padding to radius so the pointers never hit the exact edge of the screen,
    // allowing the user to seamlessly drag them infinitely outwards.
    const baseRadius = maxDist === 0 ? currentPrice * 0.1 : maxDist
    const radius = (baseRadius * 1.25) / zoomLevel
    
    const safeRadius = Math.min(radius, currentPrice * 0.99) // prevent negative prices but preserve exact symmetry
    return [currentPrice - safeRadius, currentPrice + safeRadius]
  }, [liquidityData, currentPrice, zoomLevel, lowerPrice, upperPrice])
  useEffect(() => {
    const minP = priceOrientation === 'token1PerToken0' ? tickToPrice(selectedLowerTick) : tickToPrice(selectedUpperTick)
    const maxP = priceOrientation === 'token1PerToken0' ? tickToPrice(selectedUpperTick) : tickToPrice(selectedLowerTick)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMinPriceInput(formatAmount(minP))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMaxPriceInput(formatAmount(maxP))
  }, [selectedLowerTick, selectedUpperTick, priceOrientation, decimals0, decimals1])
  // BUG 8 FIX: Amount coupling respects depositMode
  useEffect(() => {
    if (!Number.isFinite(baseRatio) || baseRatio <= 0) return
    // Single-sided: force the non-required amount to empty so it doesn't leave a sticky "0"
    if (depositMode === 'token0Only') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount1('')
      return
    }
    if (depositMode === 'token1Only') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount0('')
      return
    }
    // Both mode: couple amounts via CLMM liquidity math
    const sqrtP = Math.pow(1.0001, priceTick / 2)
    const sqrtPL = Math.pow(1.0001, selectedLowerTick / 2)
    const sqrtPU = Math.pow(1.0001, selectedUpperTick / 2)
    if (activeField === 'amount0') {
      if (amount0.trim() === '') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAmount1('')
        return
      }
      const a0_raw = Number(amount0) * Math.pow(10, decimals0)
      const L0 = a0_raw * (sqrtP * sqrtPU) / (sqrtPU - sqrtP)
      const a1_raw = L0 * (sqrtP - sqrtPL)
      const nextAmount1 = (a1_raw / Math.pow(10, decimals1)) * slippageTolerance
      if (Number.isFinite(nextAmount1)) {
        setAmount1(formatAmount(nextAmount1))
      }
      return
    }
    if (amount1.trim() === '') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount0('')
      return
    }
    const a1_raw = Number(amount1) * Math.pow(10, decimals1)
    const L1 = a1_raw / (sqrtP - sqrtPL)
    const a0_raw = L1 * (sqrtPU - sqrtP) / (sqrtP * sqrtPU)
    const nextAmount0 = (a0_raw / Math.pow(10, decimals0)) * slippageTolerance
    if (Number.isFinite(nextAmount0)) {
      setAmount0(formatAmount(nextAmount0))
    }
  }, [activeField, amount0, amount1, priceTick, selectedLowerTick, selectedUpperTick, decimals0, decimals1, depositMode, slippageTolerance])
  // BUG 1 FIX: Compute range in tick-space directly (orientation-agnostic)
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const applyDefaultRange = useCallback(() => {
    const currentPriceFloat = tickToPrice(priceTick)
    // BUG FIX: Pointers set by default at +5% and -5%
    const minP = currentPriceFloat * 0.95
    const maxP = currentPriceFloat * 1.05
    
    let lowerTick: number, upperTick: number
    if (priceOrientation === 'token1PerToken0') {
      lowerTick = displayPriceToTick(minP)
      upperTick = displayPriceToTick(maxP)
    } else {
      lowerTick = displayPriceToTick(maxP)
      upperTick = displayPriceToTick(minP)
    }
    setTickLower(String(clampTick(lowerTick, tickSpacing, 'down')))
    setTickUpper(String(clampTick(upperTick, tickSpacing, 'up')))
  }, [priceTick, tickSpacing, priceOrientation])
  const resetRange = () => {
    applyDefaultRange()
  }
  const applyQuickRange = (multiplier: number) => {
    const nextBand = Math.max(tickSpacing, Math.round(tickSpacing * multiplier))
    setTickLower(String(clampTick(priceTick - nextBand, tickSpacing, 'down')))
    setTickUpper(String(clampTick(priceTick + nextBand, tickSpacing, 'up')))
  }
  const snapPriceInput = (field: 'min' | 'max', value: string) => {
    const parsedPrice = Number(value)
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      resetRange()
      return
    }
    const rawTick = displayPriceToTick(parsedPrice)
    const snapped = snapTickToSpacing(rawTick, tickSpacing)
    if (priceOrientation === 'token1PerToken0') {
      if (field === 'min') setTickLower(String(clampTick(snapped, tickSpacing, 'down')))
      else setTickUpper(String(clampTick(snapped, tickSpacing, 'up')))
    } else {
      if (field === 'min') setTickUpper(String(clampTick(snapped, tickSpacing, 'up')))
      else setTickLower(String(clampTick(snapped, tickSpacing, 'down')))
    }
  }
  // BUG FIX: Default range set only on pool load — orientation is display-only
  const hasInitializedRange = useRef(false)
  useEffect(() => {
    if (!pool || hasInitializedRange.current) return
    if (priceTick === 0 && currentTick === 0) return // Wait until tick is available
    applyDefaultRange()
    hasInitializedRange.current = true
  }, [pool, priceTick, currentTick, applyDefaultRange])
  // ── Drag handles: map pointer position to price-space (matching chart X axis) ──
  const dragIdentityRef = useRef<'lower' | 'upper' | null>(null)
  const dragOffsetRef = useRef<number>(0)
  const [visualDragPct, setVisualDragPct] = useState<number | null>(null)
  const [chartWidth, setChartWidth] = useState(0)
  useEffect(() => {
    if (chartRef.current) {
      const observer = new ResizeObserver((entries) => {
        setChartWidth(entries[0].contentRect.width)
      })
      observer.observe(chartRef.current)
      return () => observer.disconnect()
    }
  }, [chartRef])
  useEffect(() => {
    if (!draggingHandle) {
      dragIdentityRef.current = null
      return
    }
    // Lock identity at drag start
    if (!dragIdentityRef.current) {
      dragIdentityRef.current = draggingHandle
    }
    const handlePointerMove = (event: PointerEvent) => {
      const chart = chartRef.current
      if (!chart || !dragIdentityRef.current) return
      const rect = chart.getBoundingClientRect()
      // BUG FIX: Calculate plot bounds directly from container width to avoid React render-phase state bugs
      const plotX = 38
      const plotWidth = chartWidth > 0 ? chartWidth - 46 : 400
      const plotLeft = rect.left + plotX
      if (plotWidth <= 0) return
      const pct = Math.min(1, Math.max(0, (event.clientX - dragOffsetRef.current - plotLeft) / plotWidth))
      
      // Update visual state smoothly
      setVisualDragPct(pct * 100)
      // BUG FIX: Map pointer % using the EXACT visual axis domain of the Recharts graph
      const minP = Number(chartDomain[0])
      const maxP = Number(chartDomain[1])
      if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return
      const priceAtPointer = minP + pct * (maxP - minP)
      // Convert display price to tick
      const rawTick = displayPriceToTick(priceAtPointer)
      const snappedTick = snapTickToSpacing(rawTick, tickSpacing)
      const identity = dragIdentityRef.current
      if (identity === 'lower') {
        // Enforce: lower must stay below upper by at least 1 tickSpacing
        const maxAllowed = selectedUpperTick - tickSpacing
        const clamped = clampTick(Math.min(snappedTick, maxAllowed), tickSpacing, 'down')
        setTickLower(String(clamped))
      } else {
        // Enforce: upper must stay above lower by at least 1 tickSpacing
        const minAllowed = selectedLowerTick + tickSpacing
        const clamped = clampTick(Math.max(snappedTick, minAllowed), tickSpacing, 'up')
        setTickUpper(String(clamped))
      }
    }
    const handlePointerUp = () => {
      dragIdentityRef.current = null
      setDraggingHandle(null)
      setVisualDragPct(null)
      setActivePill(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingHandle, tickSpacing, chartDomain, selectedLowerTick, selectedUpperTick, visualDragPct, chartWidth])
  
  // Deterministic bounding box for the chart grid (XAxis = 38px, Right Margin = 8px)
  const activePlotBox = { x: 38, width: chartWidth > 0 ? chartWidth - 46 : 400 }

  // BUG 3 FIX: canSubmit only requires the relevant amount(s) for the deposit mode
  const canSubmit = !!program && !!wallet.publicKey && !!poolPda && !!tokenMint0 && !!tokenMint1 && !!tokenVault0 && !!tokenVault1 && !rangeIsInvalid
    && (depositMode === 'token0Only' ? Number(amount0) > 0
      : depositMode === 'token1Only' ? Number(amount1) > 0
        : Number(amount0) > 0 && Number(amount1) > 0)

  const onDeposit = async () => {
    if (!program || !wallet.publicKey || !poolPda || !tokenMint0 || !tokenMint1 || !tokenVault0 || !tokenVault1) return

    // BUG 3 FIX: Allow single-sided deposits — only require the relevant amount(s)
    const a0 = Number(amount0)
    const a1 = Number(amount1)
    if (depositMode === 'token0Only' && a0 <= 0) {
      setTxState({ status: 'error', title: 'Invalid deposit', message: 'Enter a positive amount for token 0.' })
      return
    }
    if (depositMode === 'token1Only' && a1 <= 0) {
      setTxState({ status: 'error', title: 'Invalid deposit', message: 'Enter a positive amount for token 1.' })
      return
    }
    if (depositMode === 'both' && (a0 <= 0 || a1 <= 0)) {
      setTxState({ status: 'error', title: 'Invalid deposit', message: 'Enter positive amounts for both tokens.' })
      return
    }

    const lower = Number(tickLower)
    const upper = Number(tickUpper)
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) {
      setTxState({ status: 'error', title: 'Invalid range', message: 'Lower tick must be smaller than upper tick.' })
      return
    }

    const adjustedLower = clampTick(lower, tickSpacing, 'down')
    const adjustedUpper = clampTick(upper, tickSpacing, 'up')
    const tickArrayLowerStartIndex = tickArrayStartIndex(adjustedLower, tickSpacing)
    const tickArrayUpperStartIndex = tickArrayStartIndex(adjustedUpper, tickSpacing)

    const positionNftMint = Keypair.generate()
    const positionNftAccount = getAssociatedTokenAddressSync(positionNftMint.publicKey, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const metadataAccount = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), positionNftMint.publicKey.toBuffer()],
      METADATA_PROGRAM_ID,
    )[0]
    const tokenAccount0 = getAssociatedTokenAddressSync(tokenMint0, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const tokenAccount1 = getAssociatedTokenAddressSync(tokenMint1, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const personalPosition = getPositionAddress(positionNftMint.publicKey, program.programId)[0]
    const tickArrayLower = getTickArrayAddress(poolPda, tickArrayLowerStartIndex, program.programId)[0]
    const tickArrayUpper = getTickArrayAddress(poolPda, tickArrayUpperStartIndex, program.programId)[0]

    const amount0Max = new BN(Math.max(0, Math.floor(Number(amount0) * 10 ** decimals0 * slippageTolerance)))
    const amount1Max = new BN(Math.max(0, Math.floor(Number(amount1) * 10 ** decimals1 * slippageTolerance)))

    const calcLiquidity = () => {
      const sqrtP = Math.pow(1.0001, priceTick / 2)
      const sqrtPL = Math.pow(1.0001, adjustedLower / 2)
      const sqrtPU = Math.pow(1.0001, adjustedUpper / 2)
      
      const a0 = Number(amount0) * Math.pow(10, decimals0)
      const a1 = Number(amount1) * Math.pow(10, decimals1)
      
      let L: number
      if (priceTick < adjustedLower) {
        L = a0 * (sqrtPL * sqrtPU) / (sqrtPU - sqrtPL)
      } else if (priceTick >= adjustedUpper) {
        L = a1 / (sqrtPU - sqrtPL)
      } else {
        const L0 = a0 * (sqrtP * sqrtPU) / (sqrtPU - sqrtP)
        const L1 = a1 / (sqrtP - sqrtPL)
        L = Math.min(L0, L1)
      }
      return new BN(Math.max(0, Math.floor(L)))
    }
    const liquidity = calcLiquidity()

    setBusy(true)
    setTxState({
      status: 'info',
      title: 'Preparing deposit',
      message: 'Building the open-position transaction.',
      details: [
        `Pool: ${formattedPool}`,
        `Tick range: ${adjustedLower} to ${adjustedUpper}`,
        `Deposit: ${amount0} / ${amount1}`,
      ].join('\n'),
    })

    try {
      // Use openPositionV2 which supports Token-2022 vaults
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instruction = await (program.methods as any)
        .openPositionV2(
          adjustedLower,
          adjustedUpper,
          tickArrayLowerStartIndex,
          tickArrayUpperStartIndex,
          liquidity,
          amount0Max,
          amount1Max,
          true,   // with_metadata
          null,   // base_flag
        )
        .accounts({
          payer: wallet.publicKey,
          positionNftOwner: wallet.publicKey,
          positionNftMint: positionNftMint.publicKey,
          positionNftAccount,
          metadataAccount,
          poolState: poolPda,
          protocolPosition: PublicKey.default,
          tickArrayLower,
          tickArrayUpper,
          personalPosition,
          tokenAccount0,
          tokenAccount1,
          tokenVault0,
          tokenVault1,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: METADATA_PROGRAM_ID,
          tokenProgram2022: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
          vault0Mint: tokenMint0,
          vault1Mint: tokenMint1,
        })
        .signers([positionNftMint])
        .instruction()

      const tx = new Transaction().add(instruction)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      tx.feePayer = wallet.publicKey
      tx.recentBlockhash = blockhash
      if (!wallet.signTransaction) {
        throw new Error('Wallet does not support transaction signing')
      }

      const signedTx = await wallet.signTransaction(tx)
      signedTx.partialSign(positionNftMint)

      const rawTransaction = signedTx.serialize()
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      })
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

      addTransaction(signature, `Deposited liquidity into ${token0Name} / ${token1Name}`)

      const mintAddress = positionNftMint.publicKey.toBase58()
      const positionAddressStr = personalPosition.toBase58()

      setTxState({
        status: 'success',
        title: 'Deposit successful',
        message: 'Your position NFT was minted and returned to your wallet.',
        signature,
        details: [
          `NFT mint: ${mintAddress}`,
          `Position: ${positionAddressStr}`,
        ].join('\n'),
      })

      // Show NFT overlay
      setNftOverlay({ mintAddress, positionAddress: positionAddressStr })

      // Refresh on-chain data so chart reflects new deposit
      setRefreshTrigger(prev => prev + 1)
      
      // Refresh global pool cache so the liquidity page is updated
      if (refreshPools) {
        refreshPools()
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as any
      setTxState({
        status: 'error',
        title: 'Deposit failed',
        message: error?.message || 'Unable to open the position.',
        details: error?.logs?.join('\n') || (error instanceof Error ? error.stack : String(error)) || null,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clmm-page">
      <div className="clmm-form-top">
        <Link className="clmm-back-link" to="/">&lt; Back</Link>
        <div className="clmm-form-title">Deposit into a live CLMM pool</div>
      </div>

      <div className="deposit-shell">
        {/* ── Hero card ── */}
        <div className="deposit-hero-card">
          <div className="deposit-hero-left">
            <div className="deposit-hover-wrapper" onMouseEnter={showPoolHover} onMouseLeave={hidePoolHover}>
              <div className="deposit-pool-icons" style={{ cursor: 'pointer' }} title="Hover to view pool info">
                <div className="deposit-symbol-sphere deposit-sphere-a" style={{ background: token0Color }} title={tokenMint0?.toBase58()}>
                  {token0Label}
                </div>
                <div className="deposit-symbol-sphere deposit-sphere-b" style={{ background: token1Color, marginLeft: '-12px' }} title={tokenMint1?.toBase58()}>
                  {token1Label}
                </div>
              </div>
              {poolHoverVisible && pool && (
                <div className="deposit-hover-card" onMouseEnter={showPoolHover} onMouseLeave={hidePoolHover}>
                  <div className="deposit-hover-row">
                    <span><strong>Pool id:</strong> {pool.poolPda ?? 'unknown'}</span>
                    <button className="deposit-copy-btn" onClick={() => { void copyText(pool.poolPda, 'pool') }} title="Copy pool id" aria-label="Copy pool id">
                      {copiedKey === 'pool' ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
                    </button>
                  </div>
                  <div className="deposit-hover-row">
                    <span><strong>Token0:</strong> {tokenMint0?.toBase58() ?? '-'}</span>
                    <button className="deposit-copy-btn" onClick={() => { void copyText(tokenMint0?.toBase58(), 'token0') }} title="Copy token0" aria-label="Copy token0">
                      {copiedKey === 'token0' ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
                    </button>
                  </div>
                  <div className="deposit-hover-row">
                    <span><strong>Token1:</strong> {tokenMint1?.toBase58() ?? '-'}</span>
                    <button className="deposit-copy-btn" onClick={() => { void copyText(tokenMint1?.toBase58(), 'token1') }} title="Copy token1" aria-label="Copy token1">
                      {copiedKey === 'token1' ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="deposit-hero-copy">
              <div className="deposit-pool-name-row">
                <h1>{formattedPool}</h1>
                <span className="deposit-fee-pill">{feeTierLabel}</span>
              </div>
              <p>Open a unique position, deposit liquidity, and mint the NFT to your wallet in one transaction.</p>
            </div>
          </div>
        </div>

        <div className="deposit-grid">
          {/* ── Price range panel ── */}
          <section className="deposit-panel deposit-panel-range">
            <div className="deposit-panel-head">
              <div>
                <h2>Set Price Range</h2>
                <p>Adjust the active band for your position before depositing.</p>
              </div>
            </div>

            {/* ── Recharts Liquidity Depth Chart ── */}
            <div className="deposit-chart-card">
              <div className="chart-axis-labels" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span className="chart-y-title">Liquidity Depth (on-chain)</span>
                <div className="chart-zoom-controls" style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setZoomLevel(z => Math.max(0.1, z - 0.25))} style={{ background: 'rgba(57, 208, 216, 0.1)', border: '1px solid rgba(57, 208, 216, 0.3)', color: '#39d0d8', borderRadius: '4px', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>-</button>
                  <button type="button" onClick={() => setZoomLevel(z => z + 0.25)} style={{ background: 'rgba(57, 208, 216, 0.1)', border: '1px solid rgba(57, 208, 216, 0.3)', color: '#39d0d8', borderRadius: '4px', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>+</button>
                </div>
              </div>
              <div className="deposit-price-chart-container" style={{ position: 'relative' }}>
                <div className="deposit-price-chart" ref={chartRef}>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={liquidityData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                      <defs>
                        <linearGradient id="liquidityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#39d0d8" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#39d0d8" stopOpacity={0.04} />
                        </linearGradient>
                        <linearGradient id="selectedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#14f195" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="#14f195" stopOpacity={0.08} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 4" stroke="rgba(60,80,120,0.3)" vertical={false} />
                      <XAxis
                        dataKey="price"
                        type="number"
                        domain={chartDomain}
                        allowDataOverflow={true}
                        tickFormatter={(v) => formatAmount(Number(v))}
                        tick={{ fill: '#6a85ab', fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: 'rgba(60,80,120,0.4)' }}
                        label={{
                          value: `Price (${displayBaseLabel})`,
                          position: 'insideBottom',
                          offset: -2,
                          fill: '#6a85ab',
                          fontSize: 11,
                        }}
                        height={44}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v.toFixed(0)}`}
                        tick={{ fill: '#6a85ab', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={38}
                      />
                      <Tooltip content={<LiquidityTooltip />} />

                      {/* Full background area */}
                      <Area
                        type="stepAfter"
                        dataKey="liquidity"
                        stroke="#39d0d8"
                        strokeWidth={1.5}
                        fill="url(#liquidityGrad)"
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                      />

                      {/* Current price reference line */}
                      <ReferenceLine
                        x={currentPrice}
                        stroke="#ff8fd0"
                        strokeDasharray="4 3"
                        strokeWidth={2}
                        label={{
                          value: 'Current',
                          position: 'insideTopLeft',
                          fill: '#ff8fd0',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      />

                      {/* Removed buggy ReferenceLine that caused React render-phase state warnings */}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* BUG 5 FIX: Draggable handles overlaid on chart */}
                {!rangeIsInvalid && liquidityData.length > 0 && (() => {
                  const minP = Number(chartDomain[0])
                  const maxP = Number(chartDomain[1])
                  const range = maxP - minP
                  if (range <= 0) return null
                  const lowerPct = ((lowerPrice - minP) / range) * 100
                  const upperPct = ((upperPrice - minP) / range) * 100
                  const currentLowerPct = draggingHandle === 'lower' && visualDragPct !== null ? visualDragPct : lowerPct
                  const currentUpperPct = draggingHandle === 'upper' && visualDragPct !== null ? visualDragPct : upperPct
                  return (
                    <>
                      <div
                        className="chart-drag-handle chart-drag-handle-lower"
                        style={{ left: `${activePlotBox.x + (Math.max(0, Math.min(100, currentLowerPct)) / 100) * activePlotBox.width}px` }}
                        onPointerDown={(e) => { 
                          e.preventDefault()
                          setDraggingHandle('lower')
                          if (chartRef.current) {
                            const rect = chartRef.current.getBoundingClientRect()
                            const clampedPct = Math.max(0, Math.min(100, lowerPct))
                            const center = rect.left + activePlotBox.x + (clampedPct / 100) * activePlotBox.width
                            dragOffsetRef.current = e.clientX - center
                          }
                        }}
                        title={priceOrientation === 'token1PerToken0' ? `Min: ${formatAmount(lowerPrice)}` : `Max: ${formatAmount(lowerPrice)}`}
                      >
                        <div className="chart-drag-handle-line" />
                        <div className="chart-drag-handle-grip">{priceOrientation === 'token1PerToken0' ? '◀' : '▶'}</div>
                      </div>
                      <div
                        className="chart-drag-handle chart-drag-handle-upper"
                        style={{ left: `${activePlotBox.x + (Math.max(0, Math.min(100, currentUpperPct)) / 100) * activePlotBox.width}px` }}
                        onPointerDown={(e) => { 
                          e.preventDefault()
                          setDraggingHandle('upper')
                          if (chartRef.current) {
                            const rect = chartRef.current.getBoundingClientRect()
                            const clampedPct = Math.max(0, Math.min(100, upperPct))
                            const center = rect.left + activePlotBox.x + (clampedPct / 100) * activePlotBox.width
                            dragOffsetRef.current = e.clientX - center
                          }
                        }}
                        title={priceOrientation === 'token1PerToken0' ? `Max: ${formatAmount(upperPrice)}` : `Min: ${formatAmount(upperPrice)}`}
                      >
                        <div className="chart-drag-handle-line" />
                        <div className="chart-drag-handle-grip">{priceOrientation === 'token1PerToken0' ? '▶' : '◀'}</div>
                      </div>
                    </>
                  )
                })()}
              </div>
              {/* Empty state when no on-chain data */}
              {liquidityData.length === 0 && (
                <div className="chart-empty-state">No on-chain liquidity data available for this pool.</div>
              )}
              {/* Legend row */}
              <div className="deposit-chart-legend">
                <div>
                  <span>Current Price</span>
                  <strong>{formatAmount(tickToPrice(priceTick))} {displayBaseLabel}</strong>
                </div>
                <div>
                  <span>Selected Min / Max</span>
                  <strong>{formatAmount(tickToPrice(selectedLowerTick))} / {formatAmount(tickToPrice(selectedUpperTick))}</strong>
                </div>
                <button type="button" className="deposit-price-toggle" onClick={handleToggleOrientation}>
                  {priceOrientation === 'token1PerToken0' ? `Show ${token0Name} / ${token1Name}` : `Show ${token1Name} / ${token0Name}`}
                </button>
              </div>
            </div>
            <div className="deposit-range-inputs">
              <label className="deposit-range-field">
                <span>Min Price</span>
                <input value={minPriceInput} onChange={(event) => setMinPriceInput(event.target.value)} onBlur={(event) => snapPriceInput('min', event.target.value)} inputMode="decimal" />
              </label>
              <label className="deposit-range-field">
                <span>Max Price</span>
                <input value={maxPriceInput} onChange={(event) => setMaxPriceInput(event.target.value)} onBlur={(event) => snapPriceInput('max', event.target.value)} inputMode="decimal" />
              </label>
            </div>
            <div className="deposit-range-pills">
              <button type="button" className={`deposit-range-pill${activePill === '0.1' ? ' active' : ''}`} onClick={() => { applyQuickRange(1); setActivePill('0.1'); }}>± 0.1%</button>
              <button type="button" className={`deposit-range-pill${activePill === '0.3' ? ' active' : ''}`} onClick={() => { applyQuickRange(2); setActivePill('0.3'); }}>± 0.3%</button>
              <button type="button" className={`deposit-range-pill${activePill === '0.5' ? ' active' : ''}`} onClick={() => { applyQuickRange(3); setActivePill('0.5'); }}>± 0.5%</button>
              <button type="button" className={`deposit-range-pill${activePill === '1' ? ' active' : ''}`} onClick={() => { applyQuickRange(5); setActivePill('1'); }}>± 1%</button>
              <button type="button" className={`deposit-range-pill${activePill === '5' ? ' active' : ''}`} onClick={() => { applyQuickRange(10); setActivePill('5'); }}>± 5%</button>
              <button type="button" className="deposit-range-reset" onClick={() => { resetRange(); setActivePill(null); }}>Reset</button>
            </div>
          </section>
          {/* ── Deposit amount panel ── */}
          <section className={`deposit-panel deposit-panel-amount${rangeIsInvalid ? ' is-locked' : ''}`} aria-disabled={rangeIsInvalid}>
            <div className="deposit-panel-content">
              <div className="deposit-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2>Add Deposit Amount</h2>
                  <p>Enter token amounts for each side of the position.</p>
                </div>
                <div style={{ position: 'relative' }}>
                  <button 
                    type="button" 
                    className="deposit-slippage-btn"
                    onClick={() => setShowSlippageOverlay(!showSlippageOverlay)}
                  >
                    <svg width="14" height="14" viewBox="0 0 28 28" fill="#fff" className="chakra-icon chakra-icon-hover" color="var(--text-secondary)" aria-hidden="true" focusable="false" data-sentry-element="svg" data-sentry-component="MoreListControllers" data-sentry-source-file="MoreListControllers.tsx"><path d="M17.5 7.875C17.0358 7.87488 16.5906 7.69035 16.2624 7.362C15.9342 7.03365 15.7499 6.58837 15.75 6.12413C15.7501 5.65988 15.9346 5.2147 16.263 4.88651C16.5914 4.55832 17.0366 4.37401 17.5009 4.37413C17.7307 4.37418 17.9584 4.41952 18.1707 4.50754C18.3831 4.59556 18.576 4.72454 18.7385 4.88713C18.901 5.04971 19.0299 5.24271 19.1178 5.4551C19.2057 5.6675 19.2509 5.89513 19.2509 6.125C19.2508 6.35487 19.2055 6.58248 19.1175 6.79483C19.0294 7.00718 18.9005 7.20012 18.7379 7.36262C18.5753 7.52512 18.3823 7.65401 18.1699 7.74192C17.9575 7.82984 17.7299 7.87506 17.5 7.875ZM20.8757 5.25C20.4846 3.745 19.1257 2.625 17.5 2.625C15.8743 2.625 14.5154 3.745 14.1243 5.25H3.5V7H14.1243C14.5154 8.505 15.8743 9.625 17.5 9.625C19.1257 9.625 20.4846 8.505 20.8757 7H24.5V5.25H20.8757ZM17.5 23.625C17.2701 23.6249 17.0425 23.5796 16.8302 23.4916C16.6178 23.4036 16.4249 23.2746 16.2624 23.112C16.0999 22.9494 15.971 22.7564 15.8831 22.544C15.7952 22.3316 15.7499 22.104 15.75 21.8741C15.7501 21.6443 15.7954 21.4166 15.8834 21.2043C15.9714 20.9919 16.1004 20.799 16.263 20.6365C16.4256 20.474 16.6186 20.3451 16.831 20.2572C17.0434 20.1693 17.271 20.1241 17.5009 20.1241C17.9651 20.1242 18.4103 20.3088 18.7385 20.6371C19.0667 20.9655 19.251 21.4108 19.2509 21.875C19.2508 22.3392 19.0662 22.7844 18.7379 23.1126C18.4095 23.4408 17.9642 23.6251 17.5 23.625ZM17.5 18.375C15.8743 18.375 14.5154 19.495 14.1243 21H3.5V22.75H14.1243C14.5154 24.255 15.8743 25.375 17.5 25.375C19.1257 25.375 20.4846 24.255 20.8757 22.75H24.5V21H20.8757C20.4846 19.495 19.1257 18.375 17.5 18.375ZM10.5 15.75C10.2701 15.7499 10.0425 15.7046 9.83017 15.6166C9.61782 15.5286 9.42488 15.3996 9.26238 15.237C9.09988 15.0744 8.97099 14.8814 8.88308 14.669C8.79516 14.4566 8.74994 14.229 8.75 13.9991C8.75006 13.7693 8.79539 13.5416 8.88341 13.3293C8.97143 13.1169 9.10042 12.924 9.263 12.7615C9.42558 12.599 9.61858 12.4701 9.83098 12.3822C10.0434 12.2943 10.271 12.2491 10.5009 12.2491C10.9651 12.2492 11.4103 12.4338 11.7385 12.7621C12.0667 13.0905 12.251 13.5358 12.2509 14C12.2508 14.4642 12.0662 14.9094 11.7379 15.2376C11.4095 15.5658 10.9642 15.7501 10.5 15.75ZM10.5 10.5C8.87425 10.5 7.51538 11.62 7.12425 13.125H3.5V14.875H7.12425C7.51538 16.38 8.87425 17.5 10.5 17.5C12.1257 17.5 13.4846 16.38 13.8757 14.875H24.5V13.125H13.8757C13.4846 11.62 12.1257 10.5 10.5 10.5Z" data-sentry-element="path" data-sentry-source-file="MoreListControllers.tsx"></path></svg>
                    {((slippageTolerance - 1) * 100).toFixed(1).replace('.0', '')}%
                  </button>
                  {showSlippageOverlay && (
                    <div className="deposit-slippage-overlay">
                      <div className="deposit-slippage-title">Max Slippage Tolerance</div>
                      <div className="deposit-slippage-options">
                        <button type="button" className={`deposit-slippage-option${slippageTolerance === 1.01 ? ' active' : ''}`} onClick={() => { setSlippageTolerance(1.01); setShowSlippageOverlay(false) }}>1%</button>
                        <button type="button" className={`deposit-slippage-option${slippageTolerance === 1.025 ? ' active' : ''}`} onClick={() => { setSlippageTolerance(1.025); setShowSlippageOverlay(false) }}>2.5%</button>
                        <button type="button" className={`deposit-slippage-option${slippageTolerance === 1.035 ? ' active' : ''}`} onClick={() => { setSlippageTolerance(1.035); setShowSlippageOverlay(false) }}>3.5%</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: priceOrientation === 'token1PerToken0' ? 'column' : 'column-reverse', gap: '16px' }}>
                {/* Token 0 card */}
                <div className="deposit-token-card" style={{ position: 'relative' }}>
                  <div className={depositMode === 'token1Only' ? 'is-locked-blur' : ''}>
                    <div className="deposit-token-top modal-token-top-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <TokenBadge mint={tokenMint0} name={token0Name} color={token0Color} />
                      <div className="deposit-balance-box">
                        <img src="/src/assets/wallet.svg" alt="wallet" className="wallet-icon" />
                        <span>{formatAmount(balance0)}</span>
                        {balance0 > 0 && (
                          <>
                            <button type="button" className="deposit-quick-btn" onClick={() => { setAmount0(formatAmount(balance0 * 0.5)); setActiveField('amount0') }}>50%</button>
                            <button type="button" className="deposit-quick-btn" onClick={() => { setAmount0(formatAmount(balance0)); setActiveField('amount0') }}>MAX</button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="deposit-token-row">
                      <div className="deposit-token-symbol" style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong>{token0Name}</strong>
                      </div>
                      <input
                        value={amount0}
                        onFocus={() => setActiveField('amount0')}
                        onChange={(event) => setAmount0(event.target.value)}
                        inputMode="decimal"
                        disabled={rangeIsInvalid || depositMode === 'token1Only'}
                        aria-label={`Amount for ${token0Name}`}
                        className={depositMode === 'token1Only' ? 'deposit-input-disabled' : ''}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  {depositMode === 'token1Only' && (
                    <div className="deposit-token-locked-overlay">
                      <div className="deposit-token-locked-icon">
                        <img src="/src/assets/lock.svg" alt="locked" style={{ width: 24, height: 24, filter: 'invert(1)' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                        {!document.querySelector('img[src="/src/assets/lock.svg"]') && "🔒"}
                      </div>
                      <div className="deposit-token-locked-title">Single asset deposit only.</div>
                      <div className="deposit-token-locked-desc">The market price is outside your specified price range.</div>
                    </div>
                  )}
                </div>
                <div className="deposit-plus">+</div>
                {/* Token 1 card */}
                <div className="deposit-token-card" style={{ position: 'relative' }}>
                  <div className={depositMode === 'token0Only' ? 'is-locked-blur' : ''}>
                    <div className="deposit-token-top modal-token-top-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <TokenBadge mint={tokenMint1} name={token1Name} color={token1Color} />
                      <div className="deposit-balance-box">
                        <img src="/src/assets/wallet.svg" alt="wallet" className="wallet-icon" />
                        <span>{formatAmount(balance1)}</span>
                        {balance1 > 0 && (
                          <>
                            <button type="button" className="deposit-quick-btn" onClick={() => { setAmount1(formatAmount(balance1 * 0.5)); setActiveField('amount1') }}>50%</button>
                            <button type="button" className="deposit-quick-btn" onClick={() => { setAmount1(formatAmount(balance1)); setActiveField('amount1') }}>MAX</button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="deposit-token-row">
                      <div className="deposit-token-symbol" style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong>{token1Name}</strong>
                      </div>
                      <input
                        value={amount1}
                        onFocus={() => setActiveField('amount1')}
                        onChange={(event) => setAmount1(event.target.value)}
                        inputMode="decimal"
                        disabled={rangeIsInvalid || depositMode === 'token0Only'}
                        aria-label={`Amount for ${token1Name}`}
                        className={depositMode === 'token0Only' ? 'deposit-input-disabled' : ''}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  {depositMode === 'token0Only' && (
                    <div className="deposit-token-locked-overlay">
                      <div className="deposit-token-locked-icon">
                        <img src="/src/assets/lock.svg" alt="locked" style={{ width: 24, height: 24, filter: 'invert(1)' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                        {!document.querySelector('img[src="/src/assets/lock.svg"]') && "🔒"}
                      </div>
                      <div className="deposit-token-locked-title">Single asset deposit only.</div>
                      <div className="deposit-token-locked-desc">The market price is outside your specified price range.</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="deposit-total-card">
                <div>
                  <span>Total Deposit</span>
                  <strong>{formatAmount(depositTotal)}</strong>
                </div>
                <div>
                  <span>Deposit Ratio</span>
                  <strong>{depositRatio}</strong>
                </div>
              </div>
              <button className="deposit-submit" type="button" disabled={!canSubmit || busy} onClick={() => { void onDeposit() }} id="deposit-submit-btn">
                {busy ? 'Depositing…' : rangeIsInvalid ? 'Invalid price range' : depositMode !== 'both' ? `Deposit ${depositMode === 'token0Only' ? token0Name : token1Name} Only` : 'Deposit'}
              </button>
            </div>
            {rangeIsInvalid && (
              <div className="deposit-panel-lock" role="alert" aria-live="polite">
                <div className="deposit-panel-lock-badge">🔒</div>
                <div className="deposit-panel-lock-title">Invalid price range</div>
                <div className="deposit-panel-lock-copy">Adjust min and max so the selected range is valid before depositing.</div>
              </div>
            )}
          </section>
        </div>
        {txState && (
          <TransactionCard
            status={txState.status}
            title={txState.title}
            message={txState.message}
            signature={txState.signature}
            details={txState.details}
            onClose={() => setTxState(null)}
          />
        )}
      </div>
      {/* ── NFT Minted overlay ── */}
      {nftOverlay && (
        <NftOverlay
          mintAddress={nftOverlay.mintAddress}
          positionAddress={nftOverlay.positionAddress}
          onClose={() => setNftOverlay(null)}
        />
      )}
    </div>
  )
}

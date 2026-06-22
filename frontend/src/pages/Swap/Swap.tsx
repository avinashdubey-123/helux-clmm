import { useMemo, useRef, useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './Swap.css'
import useProgram from '../../utils/useProgram'
import { PublicKey, SendTransactionError } from '@solana/web3.js'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import * as anchor from '@coral-xyz/anchor'
import { getObservationAddress, getTickArrayAddress } from '../../utils/pda'
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync
} from '@solana/spl-token'
import copyIcon from '../../assets/copy.svg'
import straightArrowIcon from '../../assets/straight-arrow.svg'
import swapIcon from '../../assets/swap.svg'
import walletIcon from '../../assets/wallet.svg'
import TransactionCard from '../../components/TransactionCard/TransactionCard'
import idlJson from '../../../idl/amm_v3.json'
import { usePools } from '../../contexts/PoolsContext'
import { swapInternal } from '../../libs/swapSimulator'
import { TICK_ARRAY_SIZE } from '../../libs/constants'

const BN = anchor.BN

function getShortTokenName(address: string | undefined | null) {
  if (!address) return 'UNK'
  if (address === '11111111111111111111111111111111' || address.toLowerCase() === 'so11111111111111111111111111111111111111112') return 'SOL'
  return address.slice(0, 4).toUpperCase()
}

function getPoolDisplayName(token0: string | undefined | null, token1: string | undefined | null) {
  if (!token0 || !token1) return 'Unknown Pool'
  return `${getShortTokenName(token0)}-${getShortTokenName(token1)}`
}

function formatAmount(amount: number | string) {
  const num = typeof amount === 'string' ? Number(amount) : amount
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}



type SwapDirection = 'token0-to-token1' | 'token1-to-token0'

type PoolData = {
  poolPda: string
  token0: string | null
  token1: string | null
  ammConfig: string | null
  price?: string
  tradeFeeRate?: number
  activeLiquidity0?: number | null
  activeLiquidity1?: number | null
  isActiveLiquidityLoading?: boolean
}

function getFeeFromTradeFeeRate(fee?: number) {
  if (fee === undefined || fee === null) return '-'
  return `${(fee / 10000).toFixed(2)}%`
}

function getTokenColor(symbol: string): string {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 40%)`
}

export default function Swap() {
  const location = useLocation()
  const navigate = useNavigate()
  const rawState = (location.state as any) || {}
  const poolFromRoute = rawState?.poolPda ? (rawState as PoolData) : null
  const program = useProgram()
  const wallet = useWallet()
  const { connection } = useConnection()

  const { pools: poolsData, loadingPools, poolsError, refreshPools } = usePools()

  const allPools = useMemo<PoolData[]>(() => {
    return poolsData.map(p => ({
      poolPda: p.poolPda,
      token0: p.tokenMint0,
      token1: p.tokenMint1,
      ammConfig: p.ammConfig,
      price: undefined,
      tradeFeeRate: p.tradeFeeRate,
      activeLiquidity0: p.activeLiquidity0,
      activeLiquidity1: p.activeLiquidity1,
      isActiveLiquidityLoading: p.isActiveLiquidityLoading
    }))
  }, [poolsData])

  const [selectedPool, setSelectedPool] = useState<PoolData | null>(null)
  const [showPoolSelector, setShowPoolSelector] = useState(false)
  const [swapDirection, setSwapDirection] = useState<SwapDirection>('token0-to-token1')
  const [poolHoverInfo, setPoolHoverInfo] = useState<{ poolId?: string | null; token0?: string | null; token1?: string | null } | null>(null)
  const poolHoverTimeout = useRef<number | null>(null)

  const routePoolPda = poolFromRoute?.poolPda
  const routeMatchedPool = useMemo<PoolData | null>(() => {
    if (!routePoolPda) return null
    return allPools.find((pool) => pool.poolPda === routePoolPda) ?? null
  }, [allPools, routePoolPda])

  useEffect(() => {
    if (poolFromRoute && !selectedPool) {
      setSelectedPool(poolFromRoute as PoolData)
      return
    }
    if (selectedPool || allPools.length === 0) return

    if (routeMatchedPool) {
      setSelectedPool(routeMatchedPool)
      return
    }
    if (!poolFromRoute) {
      setSelectedPool(allPools[0])
    }
  }, [selectedPool, allPools, routeMatchedPool, poolFromRoute])

  const clearPoolHoverTimeout = () => {
    if (poolHoverTimeout.current != null) {
      clearTimeout(poolHoverTimeout.current)
      poolHoverTimeout.current = null
    }
  }

  const showPoolHover = () => {
    clearPoolHoverTimeout()
    setPoolHoverInfo({
      poolId: poolIdStr ?? null,
      token0: token0Str ?? null,
      token1: token1Str ?? null,
    })
  }

  const hidePoolHover = () => {
    clearPoolHoverTimeout()
    poolHoverTimeout.current = window.setTimeout(() => setPoolHoverInfo(null), 150)
  }

  const activePool = useMemo(() => {
    let basePool = poolFromRoute
    if (selectedPool) basePool = selectedPool
    else if (routeMatchedPool) basePool = { ...poolFromRoute, ...routeMatchedPool }

    if (!basePool) return null

    // Always look up the latest version from allPools so we get live background updates
    const freshPool = allPools.find(p => p.poolPda === basePool?.poolPda)
    return freshPool || basePool
  }, [selectedPool, routeMatchedPool, poolFromRoute, allPools])

  const poolPdaParam = useMemo(() => {
    if (!activePool?.poolPda) return undefined
    try {
      return new PublicKey(activePool.poolPda)
    } catch (e) {
      return undefined
    }
  }, [activePool?.poolPda])

  const token0MintParam = useMemo(() => {
    const mint0 = (activePool as any)?.token0 ?? (activePool as any)?.tokenMint0 ?? (activePool as any)?.token0Mint
    if (!mint0) return undefined
    try {
      return new PublicKey(mint0)
    } catch (e) {
      return undefined
    }
  }, [activePool])

  const token1MintParam = useMemo(() => {
    const mint1 = (activePool as any)?.token1 ?? (activePool as any)?.tokenMint1 ?? (activePool as any)?.token1Mint
    if (!mint1) return undefined
    try {
      return new PublicKey(mint1)
    } catch (e) {
      return undefined
    }
  }, [activePool])

  const ammConfigParam = useMemo(() => {
    if (!activePool?.ammConfig) return undefined
    try {
      return new PublicKey(activePool.ammConfig)
    } catch (e) {
      return undefined
    }
  }, [activePool?.ammConfig])


  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [slippage, setSlippage] = useState<number>(0.5)
  const [showSlippageSelector, setShowSlippageSelector] = useState(false)
  const [lastEditedField, setLastEditedField] = useState<'input' | 'output'>('input')
  const [txResult, setTxResult] = useState<{ sig: string; explorer: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showInversePrice, setShowInversePrice] = useState(false)
  const [priceDetails, setPriceDetails] = useState<{ token0ToToken1: string; token1ToToken0: string } | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [userBalances, setUserBalances] = useState<{ token0: number; token1: number } | null>(null)
  const [insufficientLiquidity, setInsufficientLiquidity] = useState(false)

  const parseHumanAmountToBaseUnits = (value: string, decimals: number) => {
    const normalized = value.trim()
    if (!Number.isFinite(decimals) || decimals < 0) {
      throw new Error('Invalid mint decimals')
    }
    if (!/^(?:\d+)?(?:\.\d*)?$/.test(normalized)) {
      throw new Error('Invalid character')
    }

    const [wholePartRaw = '0', fractionRaw = ''] = normalized.split('.')
    const wholePart = wholePartRaw.length > 0 ? wholePartRaw : '0'
    const fractionPart = (fractionRaw + '0'.repeat(decimals)).slice(0, decimals)
    const baseUnits = `${wholePart}${fractionPart}`.replace(/^0+(?=\d)/, '')
    return new BN(baseUnits || '0')
  }

  const formatBaseUnitsToHuman = (value: typeof BN.prototype, decimals: number) => {
    if (decimals <= 0) return value.toString()

    const raw = value.toString().padStart(decimals + 1, '0')
    const wholePart = raw.slice(0, -decimals) || '0'
    const fractionPart = raw.slice(-decimals).replace(/0+$/, '')
    return fractionPart ? `${wholePart}.${fractionPart}` : wholePart
  }

  const isAlreadyProcessedError = (err: any) => {
    const rawMsg = [err?.message, err?.transactionMessage, String(err || '')].filter(Boolean).join(' ').toLowerCase()
    return rawMsg.includes('already') && rawMsg.includes('processed')
  }

  const shorten = (v?: string | null) => {
    if (!v) return '-'
    return `${v.slice(0, 4)}...${v.slice(-4)}`
  }

  const poolIdStr = activePool?.poolPda
  const token0Str = activePool?.token0
  const token1Str = activePool?.token1
  const isToken0ToToken1 = swapDirection === 'token0-to-token1'
  const inputTokenLabel = 'Input Token Amount'
  const outputTokenLabel = 'Output Token Amount'
  const inputTokenAddress = isToken0ToToken1 ? token0Str : token1Str
  const outputTokenAddress = isToken0ToToken1 ? token1Str : token0Str
  const inputTokenShort = getShortTokenName(inputTokenAddress)
  const outputTokenShort = getShortTokenName(outputTokenAddress)
  const inputQuoteLabel = getShortTokenName(inputTokenAddress)
  const outputQuoteLabel = getShortTokenName(outputTokenAddress)

  const getPoolLabel = () => {
    if (!activePool) return 'Select Pool'
    if (token0Str && token1Str) {
      return getPoolDisplayName(token0Str, token1Str)
    }
    return poolIdStr ? shorten(poolIdStr) : 'Select Pool'
  }

  const getPoolSelectorLabel = () => {
    if (loadingPools) return 'Loading pools...'
    return getPoolLabel()
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [activePoolFeeTier, setActivePoolFeeTier] = useState<string>('-')

  const parseBalanceValue = (bal: number | null | undefined): number => {
    if (bal == null) return 0
    return Number.isFinite(bal) ? bal : 0
  }

  useEffect(() => {
    const configStr = activePool?.ammConfig
    if (!configStr) {
      setActivePoolFeeTier('-')
      return
    }

    let mounted = true
    const fetchSpecificAmmConfig = async () => {
      try {
        const configPubkey = new PublicKey(configStr)
        let configAcct: any = null

        if (program) {
          try {
            configAcct = await (program.account as any).ammConfig.fetch(configPubkey)
          } catch (e) {
            console.warn('Failed to fetch via program, trying connection getAccountInfo:', e)
          }
        }

        if (!configAcct) {
          const info = await connection.getAccountInfo(configPubkey)
          if (info) {
            const coder = new anchor.BorshAccountsCoder(idlJson as any)
            try { configAcct = coder.decode('AmmConfig', info.data) } catch (e) { }
            if (!configAcct) try { configAcct = coder.decode('ammConfig', info.data) } catch (e) { }
            if (!configAcct) try { configAcct = coder.decode('amm_config', info.data) } catch (e) { }
          }
        }

        if (!mounted) return

        if (configAcct) {
          const feeRate = configAcct.tradeFeeRate ?? configAcct.trade_fee_rate ?? 0
          const feeRateNum = typeof feeRate === 'number'
            ? feeRate
            : feeRate?.toNumber
              ? feeRate.toNumber()
              : Number(feeRate?.toString?.()) || 0
          setActivePoolFeeTier(`${(feeRateNum / 10000).toFixed(2)}%`)
        } else {
          setActivePoolFeeTier('-')
        }
      } catch (err) {
        console.error('Error fetching specific AMM config:', err)
        if (mounted) {
          setActivePoolFeeTier('-')
        }
      }
    }

    fetchSpecificAmmConfig()
    return () => {
      mounted = false
    }
  }, [activePool?.ammConfig, program, connection])

  const quoteTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (quoteTimeoutRef.current) clearTimeout(quoteTimeoutRef.current)
    }
  }, [])

  const updateInputAmount = async (value: string) => {
    setLastEditedField('input')
    setAmountIn(value)

    if (quoteTimeoutRef.current) {
      clearTimeout(quoteTimeoutRef.current)
    }

    if (!value || Number(value) <= 0) {
      setAmountOut('')
      setInsufficientLiquidity(false)
      return
    }

    quoteTimeoutRef.current = setTimeout(async () => {
      try {
        const quote = await quoteExactIn(value)
        setAmountOut(formatBaseUnitsToHuman(quote.receiveAmount, quote.outputDecimals))
        setInsufficientLiquidity(quote.insufficientLiquidity || false)
      } catch (err) {
        setAmountOut('')
        setInsufficientLiquidity(false)
      }
    }, 1000)
  }

  const updateOutputAmount = async (value: string) => {
    setLastEditedField('output')
    setAmountOut(value)

    if (quoteTimeoutRef.current) {
      clearTimeout(quoteTimeoutRef.current)
    }

    if (!value || Number(value) <= 0) {
      setAmountIn('')
      setInsufficientLiquidity(false)
      return
    }

    quoteTimeoutRef.current = setTimeout(async () => {
      try {
        const quote = await quoteExactOut(value)
        setAmountIn(formatBaseUnitsToHuman(quote.maxInputPreFee, quote.inputDecimals))
        setInsufficientLiquidity(quote.insufficientLiquidity || false)
      } catch (err) {
        setAmountIn('')
        setInsufficientLiquidity(false)
      }
    }, 1000)
  }

  const previousConnectedRef = useRef(false)
  useEffect(() => {
    previousConnectedRef.current = wallet.connected
  }, [wallet.connected])

  useEffect(() => {
    if (!activePool) {
      setUserBalances(null)
      return
    }

    let mounted = true
    const fetchBalances = async () => {
      try {
        const originalPool = poolsData.find(p => p.poolPda === activePool.poolPda)
        if (!originalPool) return

        const mint0Str = originalPool.tokenMint0
        const mint1Str = originalPool.tokenMint1

        if (!mint0Str || !mint1Str) return

        let dec0 = Number((originalPool as any).decimals0 ?? 0)
        let dec1 = Number((originalPool as any).decimals1 ?? 0)

        const isSol0 = mint0Str.toLowerCase() === 'so11111111111111111111111111111111111111112' || mint0Str === '11111111111111111111111111111111'
        const isSol1 = mint1Str.toLowerCase() === 'so11111111111111111111111111111111111111112' || mint1Str === '11111111111111111111111111111111'

        const fmt = (val: number) => formatAmount(val)

        const callWithRetry = async <T extends unknown>(fn: () => Promise<T>, maxRetries = 5): Promise<T> => {
          let attempt = 0
          while (attempt < maxRetries) {
            attempt++
            try {
              return await fn()
            } catch (err: any) {
              const msg = String(err?.message || '').toLowerCase()
              if (attempt < maxRetries && (msg.includes('429') || msg.includes('too many requests'))) {
                const wait = Math.min(200 * Math.pow(2, attempt), 2000) + Math.round(Math.random() * 100)
                await new Promise((r) => setTimeout(r, wait))
                continue
              }
              throw err
            }
          }
          throw new Error('Max retries reached')
        }

        if (dec0 === 0 && !isSol0) {
          try {
            const mInfo = await callWithRetry(() => getMint(connection, new PublicKey(mint0Str), 'confirmed', TOKEN_PROGRAM_ID))
            dec0 = mInfo.decimals
          } catch (e) { }
        }
        if (dec1 === 0 && !isSol1) {
          try {
            const mInfo = await callWithRetry(() => getMint(connection, new PublicKey(mint1Str), 'confirmed', TOKEN_PROGRAM_ID))
            dec1 = mInfo.decimals
          } catch (e) { }
        }



        let bal0 = 0
        let bal1 = 0

        if (wallet.publicKey) {
          const owner = wallet.publicKey
          const mint0 = new PublicKey(mint0Str)
          const mint1 = new PublicKey(mint1Str)
          const tokenProgram0 = TOKEN_PROGRAM_ID
          const tokenProgram1 = TOKEN_PROGRAM_ID

          if (isSol0) {
            const solBal = await callWithRetry(() => connection.getBalance(owner))
            bal0 = solBal / 1e9
          } else {
            const ata0 = getAssociatedTokenAddressSync(mint0, owner, true, tokenProgram0)
            const b0 = await callWithRetry(() => connection.getTokenAccountBalance(ata0)).catch(() => null)
            if (b0) {
              bal0 = b0.value.uiAmount != null ? b0.value.uiAmount : Number(b0.value.amount) / Math.pow(10, dec0)
            }
          }

          if (isSol1) {
            const solBal = await callWithRetry(() => connection.getBalance(owner))
            bal1 = solBal / 1e9
          } else {
            const ata1 = getAssociatedTokenAddressSync(mint1, owner, true, tokenProgram1)
            const b1 = await callWithRetry(() => connection.getTokenAccountBalance(ata1)).catch(() => null)
            if (b1) {
              bal1 = b1.value.uiAmount != null ? b1.value.uiAmount : Number(b1.value.amount) / Math.pow(10, dec1)
            }
          }
        }

        if (mounted) {
          setUserBalances(wallet.publicKey ? { token0: bal0, token1: bal1 } : null)
        }
      } catch (e) {
        console.error('Error fetching balances:', e)
      }
    }

    fetchBalances()
    return () => {
      mounted = false
    }
  }, [wallet.publicKey, activePool, connection, poolsData])

  const toggleSwapDirection = () => {
    setSwapDirection((current) => (current === 'token0-to-token1' ? 'token1-to-token0' : 'token0-to-token1'))
    setAmountIn(amountOut)
    setAmountOut(amountIn)
    setLastEditedField('input')
    setStatus(null)
    setErrorDetails(null)
    setTxResult(null)
  }

  const copyText = async (value?: string | null) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch (e) { }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSwap()
  }

  const loadSwapContext = async (ownerPublicKey?: PublicKey) => {
    let t0 = token0MintParam as PublicKey | undefined
    let t1 = token1MintParam as PublicKey | undefined
    if (!t0 || !t1) {
      throw new Error('Selected pool is missing token mint addresses')
    }

    let poolAddr = poolPdaParam
    if (!poolAddr) {
      throw new Error('Selected pool is missing poolPda')
    }

    const inputTokenProgram = TOKEN_PROGRAM_ID
    const outputTokenProgram = TOKEN_PROGRAM_ID
    const inputTokenAccount = ownerPublicKey ? getAssociatedTokenAddressSync(t0!, ownerPublicKey, true, inputTokenProgram) : null
    const outputTokenAccount = ownerPublicKey ? getAssociatedTokenAddressSync(t1!, ownerPublicKey, true, outputTokenProgram) : null

    let mint0: any = { decimals: 9 }
    let mint1: any = { decimals: 9 }
    try { mint0 = await getMint(connection, t0!, 'confirmed', inputTokenProgram) } catch (e) { }
    try { mint1 = await getMint(connection, t1!, 'confirmed', outputTokenProgram) } catch (e) { }

    let poolStateAcct: any = null
    if (program) {
      poolStateAcct = await (program.account as any).poolState.fetch(poolAddr)
    } else {
      const info = await connection.getAccountInfo(poolAddr)
      if (!info) throw new Error('Pool account not found')
      const coder = new anchor.BorshAccountsCoder(idlJson as any)
      try { poolStateAcct = coder.decode('poolState', info.data) } catch (e) { }
      if (!poolStateAcct) try { poolStateAcct = coder.decode('pool_state', info.data) } catch (e) { }
      if (!poolStateAcct) try { poolStateAcct = coder.decode('PoolState', info.data) } catch (e) { }
      if (!poolStateAcct) throw new Error('Failed to decode pool state')
    }

    const [observationState] = getObservationAddress(poolAddr, program ? (program as any).programId : new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"))

    const token0Vault = poolStateAcct.tokenVault0 || poolStateAcct.token_vault_0
    const token1Vault = poolStateAcct.tokenVault1 || poolStateAcct.token_vault_1

    const tradeFeeRate = new BN(poolStateAcct.ammConfig ? 0 : 0)

    return {
      t0: t0!,
      t1: t1!,
      mint0,
      mint1,
      tradeFeeRate,
      observationState,
      poolAddr,
      token0Vault,
      token1Vault,
      inputTokenProgram,
      outputTokenProgram,
      inputTokenAccount,
      outputTokenAccount,
      poolStateAcct
    }
  }

  const getDirectionalContext = async (
    ctx: Awaited<ReturnType<typeof loadSwapContext>>,
    ownerPublicKey?: PublicKey,
    direction: SwapDirection = swapDirection,
  ) => {
    const inputIsToken0 = direction === 'token0-to-token1'
    const inputMint = inputIsToken0 ? ctx.t0 : ctx.t1
    const outputMint = inputIsToken0 ? ctx.t1 : ctx.t0
    const inputDecimals = Number(inputIsToken0 ? ctx.mint0.decimals ?? 0 : ctx.mint1.decimals ?? 0)
    const outputDecimals = Number(inputIsToken0 ? ctx.mint1.decimals ?? 0 : ctx.mint0.decimals ?? 0)
    const inputVault = inputIsToken0 ? ctx.token0Vault : ctx.token1Vault
    const outputVault = inputIsToken0 ? ctx.token1Vault : ctx.token0Vault
    const inputTokenProgram = TOKEN_PROGRAM_ID
    const outputTokenProgram = TOKEN_PROGRAM_ID
    const inputTokenAccount = ownerPublicKey ? getAssociatedTokenAddressSync(inputMint, ownerPublicKey, true, inputTokenProgram) : null
    const outputTokenAccount = ownerPublicKey ? getAssociatedTokenAddressSync(outputMint, ownerPublicKey, true, outputTokenProgram) : null

    return {
      inputIsToken0,
      inputMint,
      outputMint,
      inputDecimals,
      outputDecimals,
      inputVault,
      outputVault,
      inputTokenProgram,
      outputTokenProgram,
      inputTokenAccount,
      outputTokenAccount,
    }
  }

  const calculateSpotPrice = (poolStateAcct: any, inputIsToken0: boolean, decimals0: number, decimals1: number) => {
    const sqrtPriceX64Str = poolStateAcct.sqrtPriceX64?.toString() || '0'
    const sqrtP = Number(sqrtPriceX64Str) / Math.pow(2, 64)
    const price0_in_1 = Math.pow(sqrtP, 2) * Math.pow(10, decimals0 - decimals1)

    if (inputIsToken0) {
      return price0_in_1
    } else {
      return 1 / price0_in_1
    }
  }

  const fetchTickArraysForQuote = async (ctx: any, resolved: any) => {
    if (!program) return []
    const currentTick = ctx.poolStateAcct.tickCurrent || 0
    const tickSpacing = ctx.poolStateAcct.tickSpacing || 1
    const tickArraySizeTimesSpacing = TICK_ARRAY_SIZE * tickSpacing
    const startTickIndex = Math.floor(currentTick / tickArraySizeTimesSpacing) * tickArraySizeTimesSpacing
    const pgmId = (program as any).programId

    const [tickArrayCurrent] = getTickArrayAddress(ctx.poolAddr, startTickIndex, pgmId)
    let orderedAddresses = []
    if (resolved.inputIsToken0) {
      const [taLeft] = getTickArrayAddress(ctx.poolAddr, startTickIndex - tickArraySizeTimesSpacing, pgmId)
      const [taLeft2] = getTickArrayAddress(ctx.poolAddr, startTickIndex - 2 * tickArraySizeTimesSpacing, pgmId)
      orderedAddresses = [tickArrayCurrent, taLeft, taLeft2]
    } else {
      const [taRight] = getTickArrayAddress(ctx.poolAddr, startTickIndex + tickArraySizeTimesSpacing, pgmId)
      const [taRight2] = getTickArrayAddress(ctx.poolAddr, startTickIndex + 2 * tickArraySizeTimesSpacing, pgmId)
      orderedAddresses = [tickArrayCurrent, taRight, taRight2]
    }

    const arrays = await Promise.all(orderedAddresses.map(ta => (program.account as any).tickArrayState.fetchNullable(ta)))
    return arrays.filter(Boolean)
  }

  const quoteExactIn = async (humanAmount: string, direction: SwapDirection = swapDirection) => {
    const ctx = await loadSwapContext()
    const resolved = await getDirectionalContext(ctx, undefined, direction)
    const inputBase = parseHumanAmountToBaseUnits(humanAmount, resolved.inputDecimals)

    const tickArrays = await fetchTickArraysForQuote(ctx, resolved)

    const activeFeeTierRaw = parseFloat(activePoolFeeTier)
    const feeRateNum = isNaN(activeFeeTierRaw) ? 0 : activeFeeTierRaw * 100 // e.g. 0.25% -> 25

    let receiveAmount = new BN(0)
    let insufficientLiquidity = false

    try {
      if (tickArrays.length > 0) {
        const sim = swapInternal({
          poolInfo: ctx.poolStateAcct,
          tickArrays: tickArrays as any,
          amountSpecified: inputBase,
          sqrtPriceLimitX64: new BN(0),
          zeroForOne: resolved.inputIsToken0,
          isBaseInput: true,
          feeRate: feeRateNum
        })
        receiveAmount = sim.amountCalculated
        insufficientLiquidity = !sim.allTrade
      } else {
        throw new Error('No tick arrays')
      }
    } catch (e) {
      console.error('Precise simulation failed:', e)
      receiveAmount = new BN(0)
      insufficientLiquidity = true
    }

    return {
      inputBase,
      receiveAmount,
      inputDecimals: resolved.inputDecimals,
      outputDecimals: resolved.outputDecimals,
      insufficientLiquidity,
    }
  }

  const quoteExactOut = async (humanAmount: string, direction: SwapDirection = swapDirection) => {
    const ctx = await loadSwapContext()
    const resolved = await getDirectionalContext(ctx, undefined, direction)
    const desiredOutputBase = parseHumanAmountToBaseUnits(humanAmount, resolved.outputDecimals)

    const tickArrays = await fetchTickArraysForQuote(ctx, resolved)

    const activeFeeTierRaw = parseFloat(activePoolFeeTier)
    const feeRateNum = isNaN(activeFeeTierRaw) ? 0 : activeFeeTierRaw * 100

    let maxInputPreFee = new BN(0)
    let insufficientLiquidity = false

    try {
      if (tickArrays.length > 0) {
        const sim = swapInternal({
          poolInfo: ctx.poolStateAcct,
          tickArrays: tickArrays as any,
          amountSpecified: desiredOutputBase,
          sqrtPriceLimitX64: new BN(0),
          zeroForOne: resolved.inputIsToken0,
          isBaseInput: false,
          feeRate: feeRateNum
        })
        maxInputPreFee = sim.amountCalculated
        insufficientLiquidity = !sim.allTrade
      } else {
        throw new Error('No tick arrays')
      }
    } catch (e) {
      console.error('Precise simulation failed:', e)
      maxInputPreFee = new BN(0)
      insufficientLiquidity = true
    }

    return {
      maxInputPreFee,
      desiredOutputBase,
      inputDecimals: resolved.inputDecimals,
      outputDecimals: resolved.outputDecimals,
      insufficientLiquidity,
    }
  }

  const loadPrices = async () => {
    if (!activePool?.poolPda || !token0MintParam || !token1MintParam) {
      setPriceDetails(null)
      return
    }

    setPriceLoading(true)
    try {
      const ctx = await loadSwapContext()

      const spotPrice0_in_1 = calculateSpotPrice(ctx.poolStateAcct, true, ctx.mint0.decimals, ctx.mint1.decimals)
      const spotPrice1_in_0 = 1 / spotPrice0_in_1

      setPriceDetails({
        token0ToToken1: formatAmount(spotPrice0_in_1),
        token1ToToken0: formatAmount(spotPrice1_in_0),
      })
    } catch (err) {
      setPriceDetails(null)
    } finally {
      setPriceLoading(false)
    }
  }

  useEffect(() => {
    loadPrices()
  }, [activePool?.poolPda, token0MintParam, token1MintParam])

  async function handleSwap() {
    if (!program) {
      alert('Program not ready')
      return
    }
    if (!wallet || !wallet.publicKey) {
      alert('Connect wallet to swap')
      return
    }
    if (activeBalanceExceeded) {
      setStatus('Insufficient balance')
      return
    }

    setBusy(true)
    setStatus('Preparing swap transaction...')

    try {
      const ammConfigAccount = ammConfigParam
      if (!ammConfigAccount) {
        throw new Error('Selected pool is missing amm config')
      }
      const payer = wallet.publicKey!
      const ctx = await loadSwapContext(payer)
      const direction = await getDirectionalContext(ctx, payer)

      const preIxs: any[] = []

      const currentTick = ctx.poolStateAcct.tickCurrent || 0
      const tickSpacing = ctx.poolStateAcct.tickSpacing || 1
      const tickArraySizeTimesSpacing = TICK_ARRAY_SIZE * tickSpacing
      const startTickIndex = Math.floor(currentTick / tickArraySizeTimesSpacing) * tickArraySizeTimesSpacing
      const pgmId = (program as any).programId

      const [tickArrayCurrent] = getTickArrayAddress(ctx.poolAddr, startTickIndex, pgmId)
      const [tickArrayLeft] = getTickArrayAddress(ctx.poolAddr, startTickIndex - tickArraySizeTimesSpacing, pgmId)
      const [tickArrayRight] = getTickArrayAddress(ctx.poolAddr, startTickIndex + tickArraySizeTimesSpacing, pgmId)

      const orderedTickArrays = direction.inputIsToken0
        ? [tickArrayCurrent, tickArrayLeft, tickArrayRight]
        : [tickArrayCurrent, tickArrayRight, tickArrayLeft]

      if (lastEditedField === 'input') {
        if (Number(amountIn || '0') <= 0) {
          alert(`Enter valid ${inputTokenLabel} for swap`)
          return
        }

        const quote = await quoteExactIn(amountIn)
        const slippageBps = Math.floor(slippage * 100)
        const minimumAmountOut = quote.receiveAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000))

        setStatus('Sending swap transaction...')
        try {
          const tx = await (program as any).methods
            .swapV2(
              new anchor.BN(quote.inputBase.toString()),
              new anchor.BN(minimumAmountOut.toString()),
              new anchor.BN(0),
              true
            )
            .preInstructions(preIxs)
            .accounts({
              payer: wallet.publicKey,
              ammConfig: ammConfigAccount,
              poolState: ctx.poolAddr,
              inputTokenAccount: direction.inputTokenAccount,
              outputTokenAccount: direction.outputTokenAccount,
              inputVault: direction.inputVault,
              outputVault: direction.outputVault,
              observationState: ctx.observationState,
              tokenProgram: TOKEN_PROGRAM_ID,
              tokenProgram2022: TOKEN_2022_PROGRAM_ID,
              memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
              inputVaultMint: direction.inputMint,
              outputVaultMint: direction.outputMint,
            })
            .remainingAccounts(
              orderedTickArrays.map(pubkey => ({
                pubkey,
                isSigner: false,
                isWritable: true,
              }))
            )
            .rpc()

          setTxResult({ sig: tx, explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet' })

          await connection.confirmTransaction(tx, 'confirmed').catch(() => null)
          void refreshPools()
          await loadPrices()
          setStatus(null)
          setBusy(false)
          return
        } catch (err: any) {
          if (!isAlreadyProcessedError(err)) {
            console.error('Swap transaction failed:', err)
          }
          await showSendErrorDetails(err, wallet.publicKey ?? undefined)
          setBusy(false)
        }
      } else {
        if (Number(amountOut || '0') <= 0) {
          alert(`Enter valid ${outputTokenLabel} to receive`)
          return
        }

        const quote = await quoteExactOut(amountOut)
        const slippageBps = Math.floor(slippage * 100)
        const maximumInputPreFee = quote.maxInputPreFee.mul(new BN(10000 + slippageBps)).div(new BN(10000))

        setStatus('Sending swap transaction...')
        try {
          const tx = await (program as any).methods
            .swapV2(
              new anchor.BN(quote.desiredOutputBase.toString()),
              new anchor.BN(maximumInputPreFee.toString()),
              new anchor.BN(0),
              false
            )
            .preInstructions(preIxs)
            .accounts({
              payer: wallet.publicKey,
              ammConfig: ammConfigAccount,
              poolState: ctx.poolAddr,
              inputTokenAccount: direction.inputTokenAccount,
              outputTokenAccount: direction.outputTokenAccount,
              inputVault: direction.inputVault,
              outputVault: direction.outputVault,
              observationState: ctx.observationState,
              tokenProgram: TOKEN_PROGRAM_ID,
              tokenProgram2022: TOKEN_2022_PROGRAM_ID,
              memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
              inputVaultMint: direction.inputMint,
              outputVaultMint: direction.outputMint,
            })
            .remainingAccounts(
              orderedTickArrays.map(pubkey => ({
                pubkey,
                isSigner: false,
                isWritable: true,
              }))
            )
            .rpc()

          setTxResult({ sig: tx, explorer: 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet' })

          await connection.confirmTransaction(tx, 'confirmed').catch(() => null)
          void refreshPools()
          await loadPrices()
          setStatus(null)
          setBusy(false)
        } catch (err: any) {
          if (!isAlreadyProcessedError(err)) {
            console.error('Swap transaction failed:', err)
          }
          await showSendErrorDetails(err, wallet.publicKey ?? undefined)
          setBusy(false)
        }
      }
    } catch (err: any) {
      console.error('Swap transaction failed:', err)
      await showSendErrorDetails(err, wallet.publicKey ?? undefined)
      setBusy(false)
    }
  }

  async function showSendErrorDetails(err: any, hintAddress?: PublicKey) {
    try {
      if (isAlreadyProcessedError(err)) {
        if (hintAddress) {
          try {
            const sigs = await connection.getSignaturesForAddress(hintAddress, { limit: 1 })
            if (sigs && sigs.length > 0) {
              const latestSig = sigs[0].signature
              setTxResult({ sig: latestSig, explorer: 'https://explorer.solana.com/tx/' + latestSig + '?cluster=devnet' })
              setStatus('Transaction executed successfully.')
              setErrorDetails(null)
              return
            }
          } catch (e) { }
        }
        setStatus('Transaction appears already processed; it likely executed successfully.')
        setErrorDetails(null)
        return
      }
    } catch (e) { }
    if (err instanceof SendTransactionError || err?.name === 'SendTransactionError') {
      try {
        const logs = await err.getLogs(connection).catch(() => null)
        if (logs && logs.length) {
          setErrorDetails(logs.join('\n'))
          setStatus('Simulation failed. Click "Details" to view logs.')
          return
        }
        const sig = err?.signature || err?.txSignature || (typeof err.message === 'string' && (err.message.match(/[A-Za-z0-9]{60,88}/)?.[0])) || null
        if (sig) {
          const tx = await (connection as any).getTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch(() => null)
          const txLogs = (tx as any)?.meta?.logMessages
          if (txLogs && txLogs.length) {
            setErrorDetails(txLogs.join('\n'))
            setStatus('Transaction processed. Click "Details" to view RPC logs.')
            return
          }
        }
        setStatus('Simulation failed: ' + (err.message || String(err)))
      } catch (inner) {
        setStatus('Simulation failed: ' + (err.message || String(err)))
      }
    } else {
      setStatus('Error: ' + (err.message || String(err)))
    }
  }

  const inputBalance = isToken0ToToken1 ? userBalances?.token0 : userBalances?.token1
  const outputBalance = isToken0ToToken1 ? userBalances?.token1 : userBalances?.token0
  const cleanAmountIn = String(amountIn || '').replace(/,/g, '')
  const cleanAmountOut = String(amountOut || '').replace(/,/g, '')
  const isInputBalanceExceeded = inputBalance != null && Number(cleanAmountIn || '0') > parseBalanceValue(inputBalance)
  const isOutputBalanceExceeded = outputBalance != null && Number(cleanAmountOut || '0') > parseBalanceValue(outputBalance)
  const activeBalanceExceeded = isInputBalanceExceeded || isOutputBalanceExceeded
  const hasValidSwapAmount = Number(cleanAmountIn || '0') > 0 || Number(cleanAmountOut || '0') > 0
  const colorIn = getTokenColor(inputTokenShort)
  const colorOut = getTokenColor(outputTokenShort)
  const getIconLabel = (symbol: string) => symbol.slice(0, 2).toUpperCase()

  const canSubmitSwap = !busy && !!wallet.publicKey && hasValidSwapAmount && !activeBalanceExceeded

  const slippageDecimal = slippage / 100
  const estimatedReceived = Number(cleanAmountOut || '0')
  const estimatedInput = Number(cleanAmountIn || '0')
  const minReceived = estimatedReceived * (1 - slippageDecimal)
  const maxInput = estimatedInput * (1 + slippageDecimal)

  const currentSpotPrice = isToken0ToToken1 
    ? Number(priceDetails?.token0ToToken1 || '0') 
    : Number(priceDetails?.token1ToToken0 || '0')
  
  let priceImpact = 0
  if (estimatedInput > 0 && estimatedReceived > 0 && currentSpotPrice > 0) {
    const executionPrice = estimatedReceived / estimatedInput
    priceImpact = (1 - executionPrice / currentSpotPrice) * 100
  }

  const priceToken0 = getShortTokenName(token0Str)
  const priceToken1 = getShortTokenName(token1Str)
  const firstTokenSymbol = showInversePrice ? `${priceToken1}` : `${priceToken0}`
  const secondTokenSymbol = showInversePrice ? `${priceToken0}` : `${priceToken1}`
  const priceValue = showInversePrice ? priceDetails?.token1ToToken0 : priceDetails?.token0ToToken1
  const priceText = priceLoading
    ? 'Loading price...'
    : priceValue
      ? `1 ${firstTokenSymbol} ≈ ${priceValue} ${secondTokenSymbol}`
      : 'Price unavailable'

  const filteredPools = allPools.filter((pool) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase().trim()
    const name0 = getShortTokenName(pool.token0).toLowerCase()
    const name1 = getShortTokenName(pool.token1).toLowerCase()
    const poolName = `${name0}-${name1}`
    const token0Mint = (pool.token0 || '').toLowerCase()
    const token1Mint = (pool.token1 || '').toLowerCase()
    const poolPda = (pool.poolPda || '').toLowerCase()

    return (
      name0.includes(q) ||
      name1.includes(q) ||
      poolName.includes(q) ||
      token0Mint.includes(q) ||
      token1Mint.includes(q) ||
      poolPda.includes(q)
    )
  })

  return (
    <div className="swap-page">
      <div className="swap-layout">
        <div className="swap-main" style={{ display: 'flex', flexDirection: 'column' }}>
          <button className="swap-page__back" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }} onClick={() => navigate('/')}>
            <span style={{ fontSize: '18px' }}>{'<'}</span> Back
          </button>
          <div className="swap-page__content">
            <div className="swap-form-col">
              {txResult && (
                <div style={{ marginBottom: '24px' }}>
                  <TransactionCard
                    status="success"
                    title="Transaction Successful"
                    message="Your swap has been confirmed."
                    explorerUrl={txResult.explorer}
                    signature={txResult.sig}
                    onClose={() => setTxResult(null)}
                  />
                </div>
              )}

              {status && !txResult && (
                <TransactionCard
                  status={errorDetails ? 'error' : 'info'}
                  title={errorDetails ? 'Transaction Failed' : 'Status'}
                  message={status}
                  details={errorDetails}
                  onClose={() => {
                    setStatus(null)
                    setErrorDetails(null)
                  }}
                />
              )}

              <div className="swap-card">
                <div className="swap-header">
                  <div className="swap-title">
                    <h2>Swap</h2>
                    <div className="swap-pool-name-container">
                      <div
                        className="swap-pool-name-hover-wrapper"
                        onMouseEnter={showPoolHover}
                        onMouseLeave={hidePoolHover}
                      >
                        <span className="swap-pool-name-display">
                          {getPoolDisplayName(token0Str, token1Str)}
                        </span>
                        {poolHoverInfo && (
                          <div className="swap-pool-hover-card" onMouseEnter={showPoolHover} onMouseLeave={hidePoolHover}>
                            <div className="swap-hover-row">
                              <span><strong>Pool ID:</strong> {poolHoverInfo.poolId ?? 'unknown'}</span>
                              <button className="swap-copy-btn" onClick={() => copyText(poolHoverInfo.poolId)} title="Copy pool id" aria-label="Copy pool id">
                                {<img src={copyIcon} alt="Copy" />}
                              </button>
                            </div>
                            <div className="swap-hover-row">
                              <span><strong>Token0: </strong> {poolHoverInfo.token0 ?? '-'}</span>
                              <button className="swap-copy-btn" onClick={() => copyText(poolHoverInfo.token0)} title="Copy token0" aria-label="Copy token0">
                                <img src={copyIcon} alt="Copy" />
                              </button>
                            </div>
                            <div className="swap-hover-row">
                              <span><strong>Token1: </strong> {poolHoverInfo.token1 ?? '-'}</span>
                              <button className="swap-copy-btn" onClick={() => copyText(poolHoverInfo.token1)} title="Copy token1" aria-label="Copy token1">
                                <img src={copyIcon} alt="Copy" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="swap-pool-selector-wrapper">
                  <label className="swap-pool-label">Select Pool:</label>
                  <div className="swap-pool-selector-container">
                    <button
                      className="swap-pool-selector-btn"
                      onClick={() => setShowPoolSelector(!showPoolSelector)}
                    >
                      <span className="swap-pool-selected">{getPoolSelectorLabel()}</span>
                      <span className="swap-pool-selector-arrow">{showPoolSelector ? '▲' : '▼'}</span>
                    </button>

                    {showPoolSelector && (
                      <div className="swap-pool-dropdown">
                        <div className="swap-pool-search-container">
                          <input
                            type="text"
                            className="swap-pool-search-input"
                            placeholder="Search by token symbol or mint address..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                          />
                          {searchQuery && (
                            <button type="button" className="swap-pool-search-clear" onClick={() => setSearchQuery('')}>×</button>
                          )}
                        </div>

                        {loadingPools ? (
                          <div className="swap-pool-item swap-pool-empty">Loading pools...</div>
                        ) : poolsError ? (
                          <div className="swap-pool-item swap-pool-empty">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span>Error loading pools</span>
                              <button className="swap-pool-retry" onClick={() => { void refreshPools() }}>Retry</button>
                            </div>
                            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--if-text-secondary)' }}>{poolsError}</div>
                          </div>
                        ) : filteredPools.length === 0 ? (
                          <div className="swap-pool-item swap-pool-empty">No pools found</div>
                        ) : (
                          filteredPools.map((pool) => {
                            const name0 = getShortTokenName(pool.token0)
                            const name1 = getShortTokenName(pool.token1)
                            const poolName = `${name0}-${name1}`
                            const feeTier = getFeeFromTradeFeeRate(pool.tradeFeeRate)
                            return (
                              <button
                                key={pool.poolPda}
                                className={`swap-pool-item ${selectedPool?.poolPda === pool.poolPda ? 'active' : ''}`}
                                onClick={() => {
                                  setSelectedPool(pool)
                                  setShowPoolSelector(false)
                                  setAmountIn('')
                                  setAmountOut('')
                                }}
                              >
                                <div className="swap-pool-item__info">
                                  <div className="swap-pool-item__name">
                                    {poolName}
                                  </div>
                                  <div className="swap-pool-item__meta">
                                    <span style={{ color: "#4edde4" }}>{feeTier}</span> • {shorten(pool.poolPda)} • {name0}/{name1}
                                  </div>
                                </div>
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="swap-body">
                  <div className="swap-panel pool-details-panel">
                    <h3>Pool Details</h3>
                    {activePool ? (
                      <div className="pool-details-content">
                        <div className="pool-details-header">
                          <div className="pool-details-header__badge">
                            {getPoolDisplayName(token0Str, token1Str)}
                          </div>
                          <div className="pool-details-header__fee">
                            {activePoolFeeTier} Fee
                          </div>
                        </div>

                        <div className="pool-details-grid">
                          <div className="pool-details-card">
                            <span className="pool-details-card__label">Current Price</span>
                            <span className="pool-details-card__value">{priceText}</span>
                          </div>

                          <div className="pool-details-card">
                            <span className="pool-details-card__label">Your Balance</span>
                            <div className="pool-details-balances">
                              <div className="pool-balance-row">
                                <span className="pool-balance-token">{getShortTokenName(token0Str)} </span>
                                <span className="pool-balance-amount">{userBalances?.token0 != null ? formatAmount(userBalances.token0) : '0'}</span>
                              </div>
                              <div className="pool-balance-row">
                                <span className="pool-balance-token">{getShortTokenName(token1Str)} </span>
                                <span className="pool-balance-amount">{userBalances?.token1 != null ? formatAmount(userBalances.token1) : '0'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="pool-details-empty">Select a pool to view details</div>
                    )}
                  </div>

                  <div className="swap-panel">
                    <div className="swap-amount-header">
                      <h3 style={{ margin: 0 }}>Swap Amount</h3>
                      <div className="swap-slippage-container">
                        <button 
                          type="button"
                          className="swap-slippage-toggle"
                          onClick={() => setShowSlippageSelector(!showSlippageSelector)}
                          title="Slippage tolerance"
                        >
                          <span>{slippage}%</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        </button>

                        {showSlippageSelector && (
                          <div className="swap-slippage-overlay">
                            <div className="swap-slippage-overlay-title">Max Slippage</div>
                            <div className="swap-slippage-options">
                              {[0.1, 0.5, 1].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  className={`swap-slippage-option ${slippage === val ? 'active' : ''}`}
                                  onClick={() => {
                                    setSlippage(val);
                                    setShowSlippageSelector(false);
                                  }}
                                >
                                  {val}%
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <form className="swap-form" onSubmit={onSubmit}>
                      <div className={`swap-input-card ${isInputBalanceExceeded ? 'swap-input-card--invalid' : ''}`}>
                        <div className="swap-input-card-header">
                          <span className="swap-input-card-label">From</span>
                          <div className="swap-input-card-balance-wrap">
                            <img src={walletIcon} alt="Wallet" className="wallet-mini-icon" />
                            <span className="swap-input-card-balance-val">{inputBalance != null ? formatAmount(inputBalance) : '0'}</span>
                            <>
                              <button
                                type="button"
                                className="swap-input-card-btn"
                                onClick={() => {
                                  const val = parseBalanceValue(inputBalance)
                                  updateInputAmount(val > 0 ? val.toString() : '0')
                                }}
                              >
                                Max
                              </button>
                              <button
                                type="button"
                                className="swap-input-card-btn"
                                onClick={() => {
                                  const val = parseBalanceValue(inputBalance)
                                  updateInputAmount(val > 0 ? (val / 2).toString() : '0')
                                }}
                              >
                                50%
                              </button>
                            </>
                          </div>
                        </div>

                        <div className="swap-input-card-row">
                          <div className="swap-token-select-pill" onClick={() => {
                            setShowPoolSelector((prev) => {
                              if (!prev) {
                                setSearchQuery(inputTokenShort)
                                return true
                              }
                              return false
                            })
                          }}>
                            <div className="swap-token-logo-sphere" style={{ backgroundColor: colorIn }}>
                              {getIconLabel(inputTokenShort)}
                            </div>
                            <span className="swap-token-symbol">{inputTokenShort}</span>
                            <span className="swap-token-chevron">▼</span>
                          </div>

                          <div className="swap-input-amount-wrap">
                            <input
                              type="text"
                              className="swap-input-field-borderless"
                              value={amountIn}
                              onChange={(e) => updateInputAmount(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="swap-direction-toggle">
                        <button
                          type="button"
                          className="swap-direction-toggle__btn"
                          onClick={toggleSwapDirection}
                          aria-label="Swap token direction"
                          title="Swap direction"
                        >
                          <img src={straightArrowIcon} alt="arrow" className="swap-direction-toggle__arrow" />
                          <img src={swapIcon} alt="swap" className="swap-direction-toggle__swap" />
                        </button>
                      </div>

                      <div className={`swap-input-card ${isOutputBalanceExceeded ? 'swap-input-card--invalid' : ''}`}>
                        <div className="swap-input-card-header">
                          <span className="swap-input-card-label">To</span>
                          <div className="swap-input-card-balance-wrap">
                            <img src={walletIcon} alt="Wallet" className="wallet-mini-icon" />
                            <span className="swap-input-card-balance-val">{outputBalance != null ? formatAmount(outputBalance) : '0'}</span>
                            <>
                              <button
                                type="button"
                                className="swap-input-card-btn"
                                onClick={() => {
                                  const val = parseBalanceValue(outputBalance)
                                  updateOutputAmount(val > 0 ? val.toString() : '0')
                                }}
                              >
                                Max
                              </button>
                              <button
                                type="button"
                                className="swap-input-card-btn"
                                onClick={() => {
                                  const val = parseBalanceValue(outputBalance)
                                  updateOutputAmount(val > 0 ? (val / 2).toString() : '0')
                                }}
                              >
                                50%
                              </button>
                            </>
                          </div>
                        </div>

                        <div className="swap-input-card-row">
                          <div className="swap-token-select-pill" onClick={() => {
                            setShowPoolSelector((prev) => {
                              if (!prev) {
                                setSearchQuery(outputTokenShort)
                                return true
                              }
                              return false
                            })
                          }}>
                            <div className="swap-token-logo-sphere" style={{ backgroundColor: colorOut }}>
                              {getIconLabel(outputTokenShort)}
                            </div>
                            <span className="swap-token-symbol">{outputTokenShort}</span>
                            <span className="swap-token-chevron">▼</span>
                          </div>

                          <div className="swap-input-amount-wrap">
                            <input
                              type="text"
                              className="swap-input-field-borderless"
                              value={amountOut}
                              onChange={(e) => updateOutputAmount(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="swap-price-box">
                        <div className="swap-price-strip">
                          <div className="swap-price-strip__value">
                            <span className="swap-price-strip__text">{priceText}</span>
                          </div>
                          <div className="swap-price-strip__toggle">
                            <button
                              type="button"
                              className="swap-price-strip__btn"
                              onClick={() => setShowInversePrice((current) => !current)}
                              aria-label={showInversePrice ? 'Show token0 to token1 price' : 'Show token1 to token0 price'}
                            >
                              <img src={swapIcon} alt="toggle price" className="swap-price-strip__icon" />
                            </button>
                          </div>
                        </div>

                        <div className="swap-quote-mode swap-quote-mode--editing">
                          {lastEditedField === 'input'
                            ? `Editing ${inputQuoteLabel} quotes the estimated ${outputQuoteLabel} you will receive.`
                            : `Editing ${outputQuoteLabel} quotes the estimated ${inputQuoteLabel} input required.`}
                        </div>
                      </div>


                      {hasValidSwapAmount && (
                        <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--if-background-surface)', borderRadius: '12px', fontSize: '13px', color: 'var(--if-text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Price Impact</span>
                            <span style={{ color: Math.abs(priceImpact) > 5 ? '#ff4d4f' : 'inherit' }}>
                              {Math.abs(priceImpact) < 0.01 ? '<0.01' : priceImpact.toFixed(2)}%
                            </span>
                          </div>
                          {lastEditedField === 'input' ? (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Minimum Received</span>
                              <span>{minReceived.toFixed(6)} {outputTokenShort}</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Maximum Input</span>
                              <span>{maxInput.toFixed(6)} {inputTokenShort}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="swap-actions-row">
                        <button type="submit" className="swap-btn-full" disabled={!canSubmitSwap || insufficientLiquidity}>
                          {busy ? 'Swapping...' : !wallet.publicKey ? 'Connect Wallet' : activeBalanceExceeded ? 'Insufficient Balance' : insufficientLiquidity ? 'Insufficient Liquidity' : 'Swap'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
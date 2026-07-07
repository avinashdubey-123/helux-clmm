import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TransactionCard from '../../components/TransactionCard/TransactionCard'
import useProgram from '../../utils/useProgram'
import { PublicKey, SystemProgram, Keypair, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { getObservationAddress, getPoolAddress, getPoolTickArrayBitmapAddress, getPoolVaultAddress, getPositionAddress, getTickArrayAddress } from '../../utils/pda'
import { usePools } from '../../contexts/PoolsContext'
import { useTransactions } from '../../contexts/TxContext'
import { getShortTokenName } from '../../utils/token'
import { triggerPoolsRefetch } from '../../utils/cache'
import { usePositions } from '../../hooks/usePositions'
import './InitializeForm.css'

type Step = 1 | 2 | 3
type PriceUnit = 'token0' | 'token1'
type RangeMode = 'full' | 'custom'

type AmmConfigTier = {
  id: string
  index: number
  tickSpacing: number
  tradeFeeRate: number
  label: string
  blurb: string
}

const fallbackFeeTiers: AmmConfigTier[] = []

const formatFeePercent = (tradeFeeRate: number) => {
  if (!Number.isFinite(tradeFeeRate)) return '-'
  const value = tradeFeeRate > 100 ? tradeFeeRate / 10000 : tradeFeeRate
  return `${value.toFixed(value < 1 ? 2 : 2)}%`
}

const createTierLabel = (index: number, tradeFeeRate: number) => {
  const label = formatFeePercent(tradeFeeRate)
  return {
    label,
    blurb: `AMM config ${index} • live from protocol`,
  }
}

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

const clampTickToSpacing = (tick: number, tickSpacing: number, direction: 'down' | 'up') => {
  const spacing = Math.max(1, tickSpacing)
  let snapped = direction === 'down'
    ? Math.floor(tick / spacing) * spacing
    : Math.ceil(tick / spacing) * spacing
  
  const MIN_TICK = -443636
  const MAX_TICK = 443636
  if (snapped < MIN_TICK) {
    snapped = Math.ceil(MIN_TICK / spacing) * spacing
  }
  if (snapped > MAX_TICK) {
    snapped = Math.floor(MAX_TICK / spacing) * spacing
  }
  return snapped
}

const getTickArrayStartIndex = (tick: number, tickSpacing: number) => {
  const tickCount = 60 * Math.max(1, tickSpacing)
  return Math.floor(tick / tickCount) * tickCount
}

export default function InitializeForm() {
  const program = useProgram()
  const { connection } = useConnection()
  const wallet = useWallet()
  const { addTransaction } = useTransactions()
  const { refreshPools } = usePools()
  const { refreshPositions } = usePositions()
  const [step, setStep] = useState<Step>(1)
  const [completedSteps, setCompletedSteps] = useState<Step[]>([])
  const [txStatus, setTxStatus] = useState<{
    status: 'success' | 'error' | 'info'
    title: string
    message: string
    details?: string
    signature?: string
    explorerUrl?: string
  } | null>(null)
  const [selectedFeeTier, setSelectedFeeTier] = useState('')
  const [mint0Address, setMint0Address] = useState('')
  const [mint1Address, setMint1Address] = useState('')
  const [mint0Symbol] = useState('TOKEN0')
  const [mint1Symbol] = useState('TOKEN1')
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('token0')
  const [initialPrice, setInitialPrice] = useState('1')
  const [rangeMode, setRangeMode] = useState<RangeMode>('custom')
  const [rangeMin, setRangeMin] = useState('0.50')
  const [rangeMax, setRangeMax] = useState('1.50')
  const [depositToken0, setDepositToken0] = useState('0')
  const [depositToken1, setDepositToken1] = useState('0')
  
  const [ammConfigs, setAmmConfigs] = useState<AmmConfigTier[]>(fallbackFeeTiers)
  const [configsLoading, setConfigsLoading] = useState(false)
  const [configsError, setConfigsError] = useState<string | null>(null)
  const [txTimerId, setTxTimerId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadConfigs = async () => {
      if (!program) {
        setAmmConfigs([])
        setSelectedFeeTier('')
        return
      }

      setConfigsLoading(true)
      setConfigsError(null)

      try {
        const namespace = (program.account as any).ammConfig
        const loadedConfigs = typeof namespace?.all === 'function' ? await namespace.all() : []
        const mappedConfigs = loadedConfigs.map((entry: any) => {
          const index = Number(entry.account.index?.toString?.() ?? entry.account.index ?? 0)
          const tickSpacing = Number(entry.account.tickSpacing?.toString?.() ?? entry.account.tick_spacing?.toString?.() ?? 1)
          const tradeFeeRate = Number(entry.account.tradeFeeRate?.toString?.() ?? entry.account.trade_fee_rate?.toString?.() ?? 0)
          const { label } = createTierLabel(index, tradeFeeRate)

          return {
            id: entry.publicKey.toBase58(),
            index,
            tickSpacing,
            tradeFeeRate,
            label
          }
        })

        if (!cancelled) {
          setAmmConfigs(mappedConfigs)
          setSelectedFeeTier((current) => current || mappedConfigs[0]?.id || '')
        }
      } catch (error: any) {
        if (!cancelled) {
          setConfigsError(error?.message || 'Failed to load AMM configs')
          setAmmConfigs([])
          setSelectedFeeTier('')
        }
      } finally {
        if (!cancelled) setConfigsLoading(false)
      }
    }

    loadConfigs()

    return () => {
      cancelled = true
    }
  }, [program])

  useEffect(() => {
    return () => {
      if (txTimerId !== null) {
        window.clearTimeout(txTimerId)
      }
    }
  }, [txTimerId])

  const selectedTier = ammConfigs.find((tier) => tier.id === selectedFeeTier) ?? ammConfigs[0] ?? null
  const selectedTierLabel = selectedTier ? `${selectedTier.label} trading fee` : 'No AMM config selected'
  const priceValue = Number(initialPrice) || 0
  const tickSpacing = selectedTier?.tickSpacing ?? 1
  const MIN_TICK = -443636
  const MAX_TICK = 443636
  const token1PerToken0 = priceValue > 0
    ? (priceUnit === 'token0' ? 1 / priceValue : priceValue)
    : 0
  const step1Ready = mint0Address.trim().length > 0 && mint1Address.trim().length > 0 && selectedFeeTier.trim().length > 0
  const step2Ready = initialPrice.trim().length > 0 && priceValue > 0 && (rangeMode === 'full' || (Number(rangeMin) > 0 && Number(rangeMax) > 0 && Number(rangeMin) < Number(rangeMax)))
  const canAdvanceFromStep = (currentStep: Step) => {
    if (currentStep === 1) return step1Ready
    if (currentStep === 2) return step2Ready
    return false
  }

  const displayPriceToTick = (displayPrice: number) => {
    if (!Number.isFinite(displayPrice) || displayPrice <= 0) return 0
    const underlyingRatio = priceUnit === 'token0' ? 1 / displayPrice : displayPrice
    return Math.log(underlyingRatio) / Math.log(1.0001)
  }
  const snapTickToSpacing = (tick: number, direction: 'down' | 'up') => {
    const snapped = direction === 'down'
      ? Math.floor(tick / tickSpacing) * tickSpacing
      : Math.ceil(tick / tickSpacing) * tickSpacing
    return Math.min(MAX_TICK, Math.max(MIN_TICK, snapped))
  }
  const tickToDisplayPrice = (tick: number) => {
    const underlyingRatio = Math.pow(1.0001, tick)
    return priceUnit === 'token0' ? 1 / underlyingRatio : underlyingRatio
  }

  const validPriceBounds = useMemo(() => {
    const base = priceValue > 0 ? priceValue : 1
    return {
      min: base * 0.5,
      max: base * 1.5,
    }
  }, [priceValue])

  // Disable the deposit form when the custom range doesn't contain the current price
  const formDisabled = useMemo(() => {
    return false // Allow out of range initial deposits
  }, [])

  const depositMode = useMemo(() => {
    if (rangeMode === 'full') return 'both'
    const min = Number(rangeMin) || 0
    const max = Number(rangeMax) || Infinity
    
    // Determine which UI token is needed based on whether current price is below or above range
    if (priceValue < min) {
      return priceUnit === 'token1' ? 'token0Only' : 'token1Only'
    }
    if (priceValue >= max) {
      return priceUnit === 'token1' ? 'token1Only' : 'token0Only'
    }
    return 'both'
  }, [rangeMode, priceValue, rangeMin, rangeMax, priceUnit])

  useEffect(() => {
    if (rangeMode !== 'custom') return

    setRangeMin(validPriceBounds.min.toFixed(4))
    setRangeMax(validPriceBounds.max.toFixed(4))
  }, [rangeMode, validPriceBounds.min, validPriceBounds.max, priceUnit])

  useEffect(() => {
    if (priceValue <= 0) return

    const a0 = Number(depositToken0)
    const a1 = Number(depositToken1)

    if (Number.isFinite(a0) && a0 > 0) {
      setDepositToken1((a0 * token1PerToken0).toFixed(6))
    } else if (Number.isFinite(a1) && a1 > 0) {
      setDepositToken0((a1 / token1PerToken0).toFixed(6))
    }
  }, [priceUnit, priceValue])

  // When the user toggles the `priceUnit`, convert the current `initialPrice`
  // to the new unit. Preserve the input if it's not a valid positive number.
  useEffect(() => {
    // this effect runs when priceUnit changes; compute reciprocal when possible
    const numeric = Number(initialPrice)
    if (!Number.isFinite(numeric) || numeric <= 0) return

    // If priceUnit is 'token0', the displayed value means token0 per token1.
    // We want to display token1 per token0 when toggled, which is reciprocal.
    const converted = priceUnit === 'token0' ? 1 / numeric : 1 / numeric
    // Both branches compute reciprocal; keep decimal precision reasonable
    const formatted = converted.toFixed(6).replace(/\.0+$/, '')
    setInitialPrice(formatted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceUnit])

  const syncDepositFromToken0 = (value: string) => {
    setDepositToken0(value)
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0 || token1PerToken0 <= 0 || depositMode !== 'both') {
      if (depositMode !== 'both') setDepositToken1('0')
      else if (!Number.isFinite(amount) || amount < 0 || token1PerToken0 <= 0) setDepositToken1('0')
      return
    }
    setDepositToken1((amount * token1PerToken0).toFixed(6))
  }

  const syncDepositFromToken1 = (value: string) => {
    setDepositToken1(value)
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount < 0 || token1PerToken0 <= 0 || depositMode !== 'both') {
      if (depositMode !== 'both') setDepositToken0('0')
      else if (!Number.isFinite(amount) || amount < 0 || token1PerToken0 <= 0) setDepositToken0('0')
      return
    }
    setDepositToken0((amount / token1PerToken0).toFixed(6))
  }

  const shiftRange = (field: 'min' | 'max', direction: -1 | 1) => {
    const setter = field === 'min' ? setRangeMin : setRangeMax
    const currentValue = Number(field === 'min' ? rangeMin : rangeMax)
    const tickMultiplier = Math.pow(1.0001, tickSpacing)
    const nextValue = Number.isFinite(currentValue)
      ? direction === 1
        ? currentValue * tickMultiplier
        : currentValue / tickMultiplier
      : tickMultiplier
    setter(Math.max(0, nextValue).toFixed(4))
  }

  const snapRangeInput = (field: 'min' | 'max', value: string) => {
    const setter = field === 'min' ? setRangeMin : setRangeMax
    const amount = Number(value)

    if (!Number.isFinite(amount) || amount <= 0) {
      setter(value)
      return
    }

    const direction = field === 'min' ? 'down' : 'up'
    const snappedTick = snapTickToSpacing(displayPriceToTick(amount), direction)
    setter(tickToDisplayPrice(snappedTick).toFixed(4))
  }

  const goBackToStep = (target: Step) => {
    setStep(target)
    setCompletedSteps((current) => current.filter((item) => item < target))
  }

  const continueToStep = (nextStep: Step) => {
    if (!canAdvanceFromStep(step)) return

    setCompletedSteps((current) => {
      const nextCompleted = [...current]
      if (nextStep === 2 && !nextCompleted.includes(1)) nextCompleted.push(1)
      if (nextStep === 3 && !nextCompleted.includes(2)) nextCompleted.push(2)
      return nextCompleted.sort()
    })
    setStep(nextStep)
  }

  const handleCreatePoolDesign = () => {
    if (!program || !wallet.publicKey) {
      setTxStatus({
        status: 'error',
        title: 'Wallet not ready',
        message: 'Connect a wallet before creating the pool.',
      })
      return
    }
    const walletPublicKey = wallet.publicKey

    if (!step1Ready || !step2Ready) {
      setTxStatus({
        status: 'error',
        title: 'Transaction blocked',
        message: 'Complete the required fields before submitting.',
        details: [
          !step1Ready ? 'Step 1: mint addresses or fee tier missing.' : null,
          !step2Ready ? 'Step 2: initial price or range is incomplete.' : null,
        ].filter(Boolean).join('\n'),
      })
      return
    }

    let mint0: PublicKey
    let mint1: PublicKey
    let ammConfig: PublicKey
    try {
      mint0 = new PublicKey(mint0Address.trim())
      mint1 = new PublicKey(mint1Address.trim())
      ammConfig = new PublicKey(selectedFeeTier)
    } catch (error) {
      setTxStatus({
        status: 'error',
        title: 'Invalid address',
        message: 'Mint addresses or fee tier are not valid public keys.',
      })
      return
    }

    // canonicalize mint order (byte-wise) to ensure deterministic pool addresses
    let canonicalMint0 = mint0
    let canonicalMint1 = mint1
    // map deposit values provided by the user (depositToken0 corresponds to mint0Address input)
    let depositForCanonical0 = depositToken0
    let depositForCanonical1 = depositToken1
    if (Buffer.compare(mint0.toBuffer(), mint1.toBuffer()) > 0) {
      canonicalMint0 = mint1
      canonicalMint1 = mint0
      depositForCanonical0 = depositToken1
      depositForCanonical1 = depositToken0
    }
    const swapped = canonicalMint0.toBase58() !== mint0.toBase58()

    const [poolState, , tokenMint0, tokenMint1] = getPoolAddress(ammConfig, canonicalMint0, canonicalMint1, program.programId)
    const [tokenVault0] = getPoolVaultAddress(poolState, tokenMint0, program.programId)
    const [tokenVault1] = getPoolVaultAddress(poolState, tokenMint1, program.programId)
    const [observationState] = getObservationAddress(poolState, program.programId)
    const [tickArrayBitmap] = getPoolTickArrayBitmapAddress(poolState, program.programId)

    const positionNftMint = Keypair.generate()
    const positionNftAccount = getAssociatedTokenAddressSync(positionNftMint.publicKey, walletPublicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const metadataAccount = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), positionNftMint.publicKey.toBuffer()],
      METADATA_PROGRAM_ID,
    )[0]

    setTxStatus({
      status: 'info',
      title: 'Preparing transaction',
      message: 'Creating the pool and initializing a position on CLMM.',
        details: [
          `Pair: ${canonicalMint0.toBase58().slice(0, 6)} / ${canonicalMint1.toBase58().slice(0, 6)}`,
        `Fee tier: ${selectedTier?.label ?? 'n/a'}`,
        `Initial price: ${initialPrice}`,
          `Deposit: ${Number(depositForCanonical0 || 0).toFixed(6)} / ${Number(depositForCanonical1 || 0).toFixed(6)}`,
      ].join('\n'),
    })

    if (txTimerId !== null) {
      window.clearTimeout(txTimerId)
    }

    const nextTimerId = window.setTimeout(async () => {
      try {
        // compute sqrt_price_x64 (Q64.64) from the displayed initial price and mint decimals
        let decimals0 = 6
        let decimals1 = 6
        let tokenProgram0Id = TOKEN_PROGRAM_ID
        let tokenProgram1Id = TOKEN_PROGRAM_ID
        
        try {
          const resp0 = await connection.getParsedAccountInfo(canonicalMint0)
          if (resp0?.value?.owner) tokenProgram0Id = resp0.value.owner
          const parsed0 = (resp0?.value?.data as any)?.parsed
          if (parsed0?.info?.decimals != null) decimals0 = Number(parsed0.info.decimals)
        } catch (e) {
          // fallback to 6
        }
        try {
          const resp1 = await connection.getParsedAccountInfo(canonicalMint1)
          if (resp1?.value?.owner) tokenProgram1Id = resp1.value.owner
          const parsed1 = (resp1?.value?.data as any)?.parsed
          if (parsed1?.info?.decimals != null) decimals1 = Number(parsed1.info.decimals)
        } catch (e) {
          // fallback to 6
        }

        const userPrice = Number(initialPrice)
        if (!Number.isFinite(userPrice) || userPrice <= 0) {
          throw new Error('Initial price must be a valid positive number')
        }

        // Determine whether user price represents canonicalMint0/canonicalMint1
        let priceIsCanonicalToken0PerToken1 = priceUnit === 'token0'
        if (swapped) priceIsCanonicalToken0PerToken1 = !priceIsCanonicalToken0PerToken1

        const priceForConversion = priceIsCanonicalToken0PerToken1 ? 1 / userPrice : userPrice

        const priceWithDecimals = priceForConversion * Math.pow(10, decimals1) / Math.pow(10, decimals0)
        const sqrt = Math.sqrt(priceWithDecimals)
        const sqrtPriceX64Big = BigInt(Math.floor(sqrt * 2 ** 64))
        const MIN_SQRT_PRICE_X64 = 4295048016n
        const MAX_SQRT_PRICE_X64 = 79226673521066979257578248091n
        if (sqrtPriceX64Big < MIN_SQRT_PRICE_X64 || sqrtPriceX64Big >= MAX_SQRT_PRICE_X64) {
          throw new Error('Initial price resolves to a sqrt_price_x64 outside the supported range')
        }
        const sqrtPriceX64 = new BN(sqrtPriceX64Big.toString())
        
        const tokenAccount0 = getAssociatedTokenAddressSync(tokenMint0, walletPublicKey, false, tokenProgram0Id, ASSOCIATED_TOKEN_PROGRAM_ID)
        const tokenAccount1 = getAssociatedTokenAddressSync(tokenMint1, walletPublicKey, false, tokenProgram1Id, ASSOCIATED_TOKEN_PROGRAM_ID)

        const createIx = await (program.methods as any)
          .createPool(sqrtPriceX64, new BN(0))
          .accounts({
            poolCreator: walletPublicKey,
            ammConfig,
            poolState,
            tokenMint0,
            tokenMint1,
            tokenVault0,
            tokenVault1,
            observationState,
            tickArrayBitmap,
            tokenProgram0: tokenProgram0Id,
            tokenProgram1: tokenProgram1Id,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .instruction()

        // Helper to convert a user UI price to a canonical tick
        const userPriceToCanonicalTick = (uiPrice: number) => {
          let priceIsCanonicalToken0PerToken1 = priceUnit === 'token1'
          if (swapped) priceIsCanonicalToken0PerToken1 = !priceIsCanonicalToken0PerToken1
          const priceForConversion = priceIsCanonicalToken0PerToken1 ? uiPrice : 1 / uiPrice
          const pWithDecimals = priceForConversion * Math.pow(10, decimals1) / Math.pow(10, decimals0)
          return Math.log(pWithDecimals) / Math.log(1.0001)
        }

        let tickLower: number
        let tickUpper: number

        if (rangeMode === 'full') {
          tickLower = clampTickToSpacing(-443636, tickSpacing, 'down')
          tickUpper = clampTickToSpacing(443636, tickSpacing, 'up')
        } else {
          const rawTick1 = userPriceToCanonicalTick(Number(rangeMin) || 1)
          const rawTick2 = userPriceToCanonicalTick(Number(rangeMax) || 1)
          
          const minRaw = Math.min(rawTick1, rawTick2)
          const maxRaw = Math.max(rawTick1, rawTick2)

          tickLower = clampTickToSpacing(Math.floor(minRaw), tickSpacing, 'down')
          tickUpper = clampTickToSpacing(Math.ceil(maxRaw), tickSpacing, 'up')

          if (tickLower >= tickUpper) {
            tickUpper = tickLower + tickSpacing
          }
        }

        const tickArrayLowerStartIndex = getTickArrayStartIndex(tickLower, tickSpacing)
        const tickArrayUpperStartIndex = getTickArrayStartIndex(tickUpper, tickSpacing)

        const a0 = Number(depositForCanonical0 || 0) * Math.pow(10, decimals0)
        const a1 = Number(depositForCanonical1 || 0) * Math.pow(10, decimals1)

        const slippageTolerance = 1.005; // 0.5% buffer for max amounts
        const amount0Max = new BN(Math.max(0, Math.floor(a0 * slippageTolerance)))
        const amount1Max = new BN(Math.max(0, Math.floor(a1 * slippageTolerance)))

        // Calculate liquidity based on UI amounts
        const currentTick = Math.log(priceWithDecimals) / Math.log(1.0001)
        const sqrtP = Math.pow(1.0001, currentTick / 2)
        const sqrtPL = Math.pow(1.0001, tickLower / 2)
        const sqrtPU = Math.pow(1.0001, tickUpper / 2)
        
        let L: number
        if (currentTick < tickLower) {
          L = a0 * (sqrtPL * sqrtPU) / (sqrtPU - sqrtPL)
        } else if (currentTick >= tickUpper) {
          L = a1 / (sqrtPU - sqrtPL)
        } else {
          const L0 = a0 * (sqrtP * sqrtPU) / (sqrtPU - sqrtP)
          const L1 = a1 / (sqrtP - sqrtPL)
          L = Math.min(L0, L1)
        }
        const liquidity = new BN(Math.max(0, Math.floor(L)))

        const openPositionIx = await (program.methods as any)
          .openPositionV2(
            tickLower,
            tickUpper,
            tickArrayLowerStartIndex,
            tickArrayUpperStartIndex,
            liquidity,
            amount0Max,
            amount1Max,
            false, // with_metadata
            null,  // base_flag
          )
          .accounts({
            payer: walletPublicKey,
            positionNftOwner: walletPublicKey,
            positionNftMint: positionNftMint.publicKey,
            positionNftAccount,
            metadataAccount,
            poolState,
            protocolPosition: PublicKey.default,
            tickArrayLower: getTickArrayAddress(poolState, tickArrayLowerStartIndex, program.programId)[0],
            tickArrayUpper: getTickArrayAddress(poolState, tickArrayUpperStartIndex, program.programId)[0],
            personalPosition: getPositionAddress(positionNftMint.publicKey, program.programId)[0],
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

        const atomicTx = new Transaction().add(createIx, openPositionIx)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
        atomicTx.feePayer = walletPublicKey
        atomicTx.recentBlockhash = blockhash
        if (!wallet.signTransaction) {
          throw new Error('Wallet does not support transaction signing')
        }

        const signedTx = await wallet.signTransaction(atomicTx)
        signedTx.partialSign(positionNftMint)

        const rawTransaction = signedTx.serialize()
        const atomicSig = await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        })
        await connection.confirmTransaction({ signature: atomicSig, blockhash, lastValidBlockHeight }, 'confirmed')
        addTransaction(atomicSig, `Created pool ${getShortTokenName(mint0.toBase58())}-${getShortTokenName(mint1.toBase58())}`, 'Create Pool', true)

        refreshPools()
        if (wallet.publicKey) {
          triggerPoolsRefetch(wallet.publicKey.toBase58())
        }
        refreshPositions()
        setTxStatus({
          status: 'success',
          title: 'Pool created',
          message: 'Create pool and open position completed atomically in one transaction.',
          signature: atomicSig,
          explorerUrl: `https://explorer.solana.com/tx/${atomicSig}?cluster=devnet`,
          details: `Pool: ${poolState.toBase58()}`,
        })
      } catch (error: any) {
        setTxStatus({
          status: 'error',
          title: 'Transaction failed',
          message: error?.message || 'Unable to create pool and open position.',
          details: error?.logs?.join('\n') || (error instanceof Error ? error.stack : String(error)) || null,
        })
      }
    }, 300)

    setTxTimerId(nextTimerId)
  }

  const stepMeta = [
    { id: 1 as Step, title: 'Select token & fee tier' },
    { id: 2 as Step, title: 'Set initial price & range' },
    { id: 3 as Step, title: 'Deposit amount' },
  ]

  const stepBanner = [
    'First, select tokens & fee tier',
    'Next, set initial token price & position price range',
    'Last, please enter token deposit amount',
  ]

  return (
    <div className="clmm-page">
      <div className="clmm-form-top">
        <Link className="clmm-back-link" to="/">&lt; Back</Link>
        <div className="clmm-form-title">{stepBanner[step - 1]}</div>
      </div>

      <div className="clmm-layout">
        <aside className="clmm-sidebar">
          <div className="clmm-sidebar-card">
            {stepMeta.map((item) => {
              const active = step === item.id
              const completed = completedSteps.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`clmm-step ${active ? 'active' : ''} ${completed ? 'completed' : ''}`}
                  onClick={() => item.id < step && goBackToStep(item.id)}
                  disabled={item.id > step}
                >
                  <span className="clmm-step-index">{completed ? '✓' : item.id}</span>
                  <span className="clmm-step-copy">
                    <strong>Step {item.id}</strong>
                    <span>{item.title}</span>
                  </span>
                </button>
              )
            })}
          </div>

        </aside>

        <section className="clmm-workspace">
          {step === 1 && (
            <div className="clmm-panel">

              <div className="clmm-grid two-col">
                <label className="clmm-field">
                  <span>Mint A</span>
                  <input value={mint0Address} onChange={(event) => setMint0Address(event.target.value)} placeholder="Enter token mint address" disabled={formDisabled} />
                </label>
                <label className="clmm-field">
                  <span>Mint B</span>
                  <input value={mint1Address} onChange={(event) => setMint1Address(event.target.value)} placeholder="Enter token mint address" disabled={formDisabled} />
                </label>
              </div>

              <div className="clmm-subsection">
                <div className="clmm-subsection-head">
                  <div>
                    <h3>Choose fee tier</h3>
                  </div>
                </div>

                <div className="clmm-helper-line">Fees are earned in both tokens, based on trade direction.</div>

                {configsError && <div className="clmm-empty-state">{configsError}</div>}

                {configsLoading && <div className="clmm-empty-state">Loading AMM configs...</div>}

                {!configsLoading && !configsError && ammConfigs.length === 0 && (
                  <div className="clmm-empty-state">No AMM configs found on this cluster.</div>
                )}

                <div className="clmm-select-wrapper">
                  <select
                    className="clmm-select-input"
                    value={selectedFeeTier}
                    onChange={(e) => setSelectedFeeTier(e.target.value)}
                    disabled={formDisabled}
                  >
                    {ammConfigs.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.label}
                      </option>
                    ))}
                  </select>
                  <svg className="clmm-select-caret" viewBox="0 0 24 24"><path fill="currentColor" d="M7 10l5 5 5-5H7z" /></svg>
                </div>
              </div>

              <div className="clmm-footer">
                <div className="clmm-footer-summary">
                  <span>Selected fee tier</span>
                  <strong>{selectedTierLabel}</strong>
                </div>
                <button type="button" className="clmm-primary-btn" onClick={() => continueToStep(2)} disabled={!canAdvanceFromStep(1) || formDisabled}>
                  Continue to price setup
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="clmm-panel">
            

              <div className="clmm-toggle-row">
                <button type="button" className={`clmm-toggle ${priceUnit === 'token0' ? 'active' : ''}`} onClick={() => setPriceUnit('token0')} disabled={formDisabled}>
                  token0 per token1
                </button>
                <button type="button" className={`clmm-toggle ${priceUnit === 'token1' ? 'active' : ''}`} onClick={() => setPriceUnit('token1')} disabled={formDisabled}>
                  token1 per token0
                </button>
                <div className="clmm-toggle-caption">
                  Showing price as {priceUnit === 'token0' ? 'token0 per token1' : 'token1 per token0'}
                </div>
              </div>

              <div className="clmm-grid">
                <label className="clmm-field clmm-field-wide">
                  <span>Initial price</span>
                  <input value={initialPrice} onChange={(event) => setInitialPrice(event.target.value)} placeholder="0.50" inputMode="decimal" disabled={formDisabled} />
                </label>
              </div>

              <div className="clmm-subsection">
                <div className="clmm-subsection-head">
                  <div>
                    <h3>Choose range mode</h3>
                  </div>
                </div>

                <div className="clmm-range-switch">
                  <button type="button" className={`clmm-range-option ${rangeMode === 'full' ? 'active' : ''}`} onClick={() => setRangeMode('full')} disabled={formDisabled}>
                    Full range
                  </button>
                  <button type="button" className={`clmm-range-option ${rangeMode === 'custom' ? 'active' : ''}`} onClick={() => setRangeMode('custom')} disabled={formDisabled}>
                    Custom range
                  </button>
                </div>

                {rangeMode === 'custom' && (
                  <div className="clmm-grid two-col">
                    <div className="clmm-range-field">
                      <label className="clmm-field">
                        <span>Min price</span>
                      </label>
                      <div className="clmm-range-shell">
                        <button type="button" className="clmm-range-inline-btn" onClick={() => shiftRange('min', -1)} aria-label="Decrease min price" disabled={formDisabled}>-</button>
                        <input className="clmm-range-inline-input" value={rangeMin} onChange={(event) => setRangeMin(event.target.value)} onBlur={(event) => snapRangeInput('min', event.target.value)} placeholder={validPriceBounds.min.toFixed(4)} inputMode="decimal" disabled={formDisabled} />
                        <button type="button" className="clmm-range-inline-btn" onClick={() => shiftRange('min', 1)} aria-label="Increase min price" disabled={formDisabled}>+</button>
                      </div>
                    </div>
                    <div className="clmm-range-field">
                      <label className="clmm-field">
                        <span>Max price</span>
                      </label>
                      <div className="clmm-range-shell">
                        <button type="button" className="clmm-range-inline-btn" onClick={() => shiftRange('max', -1)} aria-label="Decrease max price" disabled={formDisabled}>-</button>
                        <input className="clmm-range-inline-input" value={rangeMax} onChange={(event) => setRangeMax(event.target.value)} onBlur={(event) => snapRangeInput('max', event.target.value)} placeholder={validPriceBounds.max.toFixed(4)} inputMode="decimal" disabled={formDisabled} />
                        <button type="button" className="clmm-range-inline-btn" onClick={() => shiftRange('max', 1)} aria-label="Increase max price" disabled={formDisabled}>+</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="clmm-footer">
                <button type="button" className="clmm-secondary-btn" onClick={() => goBackToStep(1)} disabled={formDisabled}>
                  Back to tokens
                </button>
                <button type="button" className="clmm-primary-btn" onClick={() => continueToStep(3)} disabled={!canAdvanceFromStep(2) || formDisabled}>
                  Continue to deposit
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="clmm-panel clmm-panel-compact">
              {txStatus && (
                <TransactionCard
                  status={txStatus.status}
                  title={txStatus.title}
                  message={txStatus.message}
                  details={txStatus.details}
                  signature={txStatus.signature}
                  explorerUrl={txStatus.explorerUrl}
                  onClose={() => setTxStatus(null)}
                />
              )}

              <div className="clmm-summary-strip">
                <div>
                  <span>Pair</span>
                  <div className="clmm-pair-display" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {/* Token 0 avatar */}
                    <div className="clmm-token-avatar" style={{ backgroundColor: '#555', color: '#fff', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '600' }}>
                      {mint0Symbol.slice(0, 2).toUpperCase()}
                    </div>
                    {/* Plus icon */}
                    <div className="clmm-pair-plus" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>+</div>
                    {/* Token 1 avatar */}
                    <div className="clmm-token-avatar" style={{ backgroundColor: '#555', color: '#fff', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '600' }}>
                      {mint1Symbol.slice(0, 2).toUpperCase()}
                    </div>
                    <strong className="pool-name-hover" title={`${mint0Symbol} (${mint0Address.slice(0,6)}) / ${mint1Symbol} (${mint1Address.slice(0,6)})`}>{mint0Symbol} / {mint1Symbol}</strong>
                  </div>
                </div>
                <div>
                  <span>Fee tier</span>
                  <strong>{selectedTier?.label ?? 'No AMM config selected'}</strong>
                </div>
                <div>
                  <span>Initial price</span>
                  <strong>{initialPrice || '-'}</strong>
                </div>
                <div>
                  <span>Range</span>
                  <strong>{rangeMode === 'full' ? 'Full range' : `${rangeMin} - ${rangeMax}`}</strong>
                </div>
              </div>

              <div className="clmm-deposit-card">
                <div style={{ position: 'relative' }}>
                  <div className={depositMode === 'token1Only' ? 'is-locked-blur' : ''}>
                    <div className="clmm-asset-row">
                      <button type="button" className="clmm-asset-pill">
                        <span className="clmm-token-dot dot-0" />
                        <strong>{mint0Symbol}</strong>
                      </button>
                    </div>
                    <div className="clmm-amount-row">
                      <input value={depositToken0} onChange={(event) => syncDepositFromToken0(event.target.value)} placeholder="0" inputMode="decimal" disabled={formDisabled || depositMode === 'token1Only'} />
                      <span>~$0</span>
                    </div>
                  </div>
                  {depositMode === 'token1Only' && (
                    <div className="clmm-token-locked-overlay">
                      <div className="clmm-token-locked-icon">
                        <img src="/src/assets/lock.svg" alt="locked" style={{ width: 24, height: 24, filter: 'invert(1)' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                        {!document.querySelector('img[src="/src/assets/lock.svg"]')}
                      </div>
                      <div className="clmm-token-locked-title">Single asset deposit only.</div>
                      <div className="clmm-token-locked-desc">The market price is outside your specified price range.</div>
                    </div>
                  )}
                </div>

                <div className="clmm-plus">+</div>

                <div style={{ position: 'relative' }}>
                  <div className={depositMode === 'token0Only' ? 'is-locked-blur' : ''}>
                    <div className="clmm-asset-row">
                      <button type="button" className="clmm-asset-pill">
                        <span className="clmm-token-dot dot-1" />
                        <strong>{mint1Symbol}</strong>
                      </button>
                    </div>
                    <div className="clmm-amount-row">
                      <input value={depositToken1} onChange={(event) => syncDepositFromToken1(event.target.value)} placeholder="0" inputMode="decimal" disabled={formDisabled || depositMode === 'token0Only'} />
                      <span>~$0</span>
                    </div>
                  </div>
                  {depositMode === 'token0Only' && (
                    <div className="clmm-token-locked-overlay">
                      <div className="clmm-token-locked-icon">
                        <img src="/src/assets/lock.svg" alt="locked" style={{ width: 24, height: 24, filter: 'invert(1)' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                        {!document.querySelector('img[src="/src/assets/lock.svg"]') && "🔒"}
                      </div>
                      <div className="clmm-token-locked-title">Single asset deposit only.</div>
                      <div className="clmm-token-locked-desc">The market price is outside your specified price range.</div>
                    </div>
                  )}
                </div>

                <div className="clmm-total-row">
                  <div>
                    <span>Total deposit </span>
                    <strong>$0</strong>
                  </div>
                  <div>
                    <span>Deposit ratio </span>
                      <strong>{`${Number(depositToken0 || 0).toFixed(6)} / ${Number(depositToken1 || 0).toFixed(6)}`}</strong>
                  </div>
                </div>
              </div>

              <div className="clmm-footer">
                <button type="button" className="clmm-secondary-btn" onClick={() => goBackToStep(2)} disabled={formDisabled}>
                  Back to range
                </button>
                <button type="button" className="clmm-primary-btn" onClick={handleCreatePoolDesign} disabled={formDisabled}>
                  Create pool design
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

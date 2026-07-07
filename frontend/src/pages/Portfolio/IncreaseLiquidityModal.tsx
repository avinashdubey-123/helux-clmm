import { useState, useEffect, useMemo, useRef } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PoolRowData } from '../../contexts/PoolsContext'
import { PositionRowData } from '../../hooks/usePositions'
import useProgram from '../../utils/useProgram'
import { getTokenBalance } from '../../utils/token'
import { useTransactions } from '../../contexts/TxContext'
import { getTickArrayAddress, getPoolRewardVaultAddress } from '../../utils/pda'
import TxSmallCard from '../../components/TxSmallCard/TxSmallCard'

function tickToPrice(tick: number) {
  return Math.pow(1.0001, tick)
}

function formatAmount(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

const clampTick = (tick: number, spacing: number, direction: 'down' | 'up') => {
  const safeSpacing = Math.max(1, spacing)
  const snapped = direction === 'down'
    ? Math.floor(tick / safeSpacing) * safeSpacing
    : Math.ceil(tick / safeSpacing) * safeSpacing
  return Math.max(-443636, Math.min(443636, snapped))
}

const tickArrayStartIndex = (tick: number, spacing: number) => {
  const tickCount = 60 * Math.max(1, spacing)
  return Math.floor(tick / tickCount) * tickCount
}

interface Props {
  pool: PoolRowData
  position: PositionRowData
  onClose: () => void
  onSuccess: () => void
}

export default function IncreaseLiquidityModal({ pool, position, onClose, onSuccess }: Props) {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  const program = useProgram()
  const { addTransaction } = useTransactions()

  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [activeField, setActiveField] = useState<'amount0' | 'amount1'>('amount0')
  const [balance0, setBalance0] = useState(0)
  const [balance1, setBalance1] = useState(0)
  const [busy, setBusy] = useState(false)
  const [txState, setTxState] = useState<{ status: 'error', title: string, message: string, details?: string } | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const calcRequestIdRef = useRef<number>(0)
  const calcTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const prevCalcStateRef = useRef({ amount0: '', amount1: '' })

  const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase()
  const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase()

  const lowerPrice = tickToPrice(position.tickLower)
  const upperPrice = tickToPrice(position.tickUpper)
  const currentTick = pool.tickCurrent
  const inRange = currentTick >= position.tickLower && currentTick <= position.tickUpper
  const currentPrice = tickToPrice(currentTick)

  useEffect(() => {
    if (!publicKey || !connection) {
      setBalance0(0)
      setBalance1(0)
      return
    }
    const mint0 = new PublicKey(pool.tokenMint0)
    const mint1 = new PublicKey(pool.tokenMint1)
    const getBalances = async () => {
      let programId0 = TOKEN_PROGRAM_ID
      let programId1 = TOKEN_PROGRAM_ID
      try {
        const resp0 = await connection.getParsedAccountInfo(mint0)
        if (resp0?.value?.owner) programId0 = resp0.value.owner
      } catch (e) { }
      try {
        const resp1 = await connection.getParsedAccountInfo(mint1)
        if (resp1?.value?.owner) programId1 = resp1.value.owner
      } catch (e) { }

      const ata0 = getAssociatedTokenAddressSync(mint0, publicKey, false, programId0, ASSOCIATED_TOKEN_PROGRAM_ID)
      const ata1 = getAssociatedTokenAddressSync(mint1, publicKey, false, programId1, ASSOCIATED_TOKEN_PROGRAM_ID)

      getTokenBalance(connection, ata0).then(b => setBalance0(b / Math.pow(10, pool.mintDecimals0))).catch(() => setBalance0(0))
      getTokenBalance(connection, ata1).then(b => setBalance1(b / Math.pow(10, pool.mintDecimals1))).catch(() => setBalance1(0))
    }

    getBalances()
  }, [publicKey, connection, pool])

  const depositMode = useMemo(() => {
    if (currentTick < position.tickLower) return 'token0Only'
    if (currentTick >= position.tickUpper) return 'token1Only'
    return 'both'
  }, [currentTick, position.tickLower, position.tickUpper])

  // Coupling math with dynamic fetch and debounce
  useEffect(() => {
    if (depositMode === 'token0Only') {
      setAmount1('')
      return
    }
    if (depositMode === 'token1Only') {
      setAmount0('')
      return
    }

    const activeAmountChanged = activeField === 'amount0'
      ? amount0 !== prevCalcStateRef.current.amount0
      : amount1 !== prevCalcStateRef.current.amount1;

    if (!activeAmountChanged) {
      return;
    }

    prevCalcStateRef.current = { amount0, amount1 };

    if (calcTimeoutRef.current) clearTimeout(calcTimeoutRef.current);

    calcTimeoutRef.current = setTimeout(async () => {
      const currentRequestId = ++calcRequestIdRef.current;
      setIsCalculating(true);

      try {
        let freshTick = currentTick;
        if (pool.poolPda && program) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawPool = await (program.account as any).poolState.fetch(new PublicKey(pool.poolPda));
          const rawTick = Number(rawPool.tickCurrent?.toString?.() ?? rawPool.tick_current?.toString?.() ?? 0);
          if (rawTick !== 0) {
            freshTick = rawTick;
          }
        }

        if (calcRequestIdRef.current !== currentRequestId) return;

        const sqrtP = Math.pow(1.0001, freshTick / 2)
        const sqrtPL = Math.pow(1.0001, position.tickLower / 2)
        const sqrtPU = Math.pow(1.0001, position.tickUpper / 2)

        if (activeField === 'amount0') {
          if (!amount0 || amount0.trim() === '') {
            setAmount1('')
          } else {
            const a0_raw = Number(amount0) * Math.pow(10, pool.mintDecimals0)
            const L0 = a0_raw * (sqrtP * sqrtPU) / (sqrtPU - sqrtP)
            const a1_raw = L0 * (sqrtP - sqrtPL)
            const nextAmount1 = a1_raw / Math.pow(10, pool.mintDecimals1)
            if (Number.isFinite(nextAmount1)) {
              setAmount1(nextAmount1.toFixed(6).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
            }
          }
        } else {
          if (!amount1 || amount1.trim() === '') {
            setAmount0('')
          } else {
            const a1_raw = Number(amount1) * Math.pow(10, pool.mintDecimals1)
            const L1 = a1_raw / (sqrtP - sqrtPL)
            const a0_raw = L1 * (sqrtPU - sqrtP) / (sqrtP * sqrtPU)
            const nextAmount0 = a0_raw / Math.pow(10, pool.mintDecimals0)
            if (Number.isFinite(nextAmount0)) {
              setAmount0(nextAmount0.toFixed(6).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
            }
          }
        }
        setIsCalculating(false);
      } catch (err) {
        setIsCalculating(false);
      }
    }, 400);
  }, [activeField, amount0, amount1, currentTick, position.tickLower, position.tickUpper, pool.mintDecimals0, pool.mintDecimals1, depositMode, program, pool.poolPda])

  const a0Num = Number(amount0) || 0
  const a1Num = Number(amount1) || 0
  const depositTotal = a0Num + a1Num
  const exceedBalance0 = a0Num > balance0
  const exceedBalance1 = a1Num > balance1
  const exceedBalance = exceedBalance0 || exceedBalance1

  const depositRatio = useMemo(() => {
    if (depositMode === 'token0Only') return `100% ${t0Name} / 0% ${t1Name}`
    if (depositMode === 'token1Only') return `0% ${t0Name} / 100% ${t1Name}`

    const sqrtP = Math.pow(1.0001, currentTick / 2)
    const sqrtPL = Math.pow(1.0001, position.tickLower / 2)
    const sqrtPU = Math.pow(1.0001, position.tickUpper / 2)

    // Raw token amounts for L=1
    const a0_raw = (sqrtPU - sqrtP) / (sqrtP * sqrtPU)
    const a1_raw = sqrtP - sqrtPL

    // Convert to display units
    const a0_display = a0_raw / Math.pow(10, pool.mintDecimals0)
    const a1_display = a1_raw / Math.pow(10, pool.mintDecimals1)

    // Calculate USD/quote value representation
    const baseRatio = currentPrice * Math.pow(10, pool.mintDecimals0 - pool.mintDecimals1)
    const value0 = a0_display * (Number.isFinite(baseRatio) && baseRatio > 0 ? baseRatio : 1)
    const value1 = a1_display
    const totalValue = value0 + value1

    if (totalValue > 0) {
      const pct0 = Math.round((value0 / totalValue) * 100)
      return `${pct0}% ${t0Name} / ${100 - pct0}% ${t1Name}`
    }

    return `0% ${t0Name} / 0% ${t1Name}`
  }, [depositMode, currentTick, position.tickLower, position.tickUpper, pool.mintDecimals0, pool.mintDecimals1, currentPrice, t0Name, t1Name])

  const handleDeposit = async () => {
    if (!program || !publicKey || !signTransaction) return
    setTxState(null)
    setBusy(true)

    try {
      const PROGRAMMATIC_SLIPPAGE = 1.005; // 0.5% hidden slippage buffer to prevent tick math precision errors on-chain
      const amount0Max = new BN(Math.max(0, Math.floor(a0Num * 10 ** pool.mintDecimals0 * PROGRAMMATIC_SLIPPAGE)))
      const amount1Max = new BN(Math.max(0, Math.floor(a1Num * 10 ** pool.mintDecimals1 * PROGRAMMATIC_SLIPPAGE)))

      const sqrtP = Math.pow(1.0001, currentTick / 2)
      const sqrtPL = Math.pow(1.0001, position.tickLower / 2)
      const sqrtPU = Math.pow(1.0001, position.tickUpper / 2)

      const a0Raw = a0Num * Math.pow(10, pool.mintDecimals0)
      const a1Raw = a1Num * Math.pow(10, pool.mintDecimals1)

      let L: number
      if (currentTick < position.tickLower) {
        L = a0Raw * (sqrtPL * sqrtPU) / (sqrtPU - sqrtPL)
      } else if (currentTick >= position.tickUpper) {
        L = a1Raw / (sqrtPU - sqrtPL)
      } else {
        const L0 = a0Raw * (sqrtP * sqrtPU) / (sqrtPU - sqrtP)
        const L1 = a1Raw / (sqrtP - sqrtPL)
        L = Math.min(L0, L1)
      }
      const liquidity = new BN(Math.max(0, Math.floor(L)))

      const poolPda = new PublicKey(pool.poolPda)
      const tickSpacing = pool.tickSpacing
      const adjustedLower = clampTick(position.tickLower, tickSpacing, 'down')
      const adjustedUpper = clampTick(position.tickUpper, tickSpacing, 'up')

      const tickArrayLowerStartIndex = tickArrayStartIndex(adjustedLower, tickSpacing)
      const tickArrayUpperStartIndex = tickArrayStartIndex(adjustedUpper, tickSpacing)

      const positionNftMint = new PublicKey(position.nftMint)
      const positionNftAccount = getAssociatedTokenAddressSync(positionNftMint, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
      const tokenMint0 = new PublicKey(pool.tokenMint0)
      const tokenMint1 = new PublicKey(pool.tokenMint1)
      let tokenProgram0Id = TOKEN_PROGRAM_ID
      let tokenProgram1Id = TOKEN_PROGRAM_ID
      try {
        const resp0 = await connection.getParsedAccountInfo(tokenMint0)
        if (resp0?.value?.owner) tokenProgram0Id = resp0.value.owner
      } catch (e) { }
      try {
        const resp1 = await connection.getParsedAccountInfo(tokenMint1)
        if (resp1?.value?.owner) tokenProgram1Id = resp1.value.owner
      } catch (e) { }

      const tokenAccount0 = getAssociatedTokenAddressSync(tokenMint0, publicKey, false, tokenProgram0Id, ASSOCIATED_TOKEN_PROGRAM_ID)
      const tokenAccount1 = getAssociatedTokenAddressSync(tokenMint1, publicKey, false, tokenProgram1Id, ASSOCIATED_TOKEN_PROGRAM_ID)

      const tickArrayLower = getTickArrayAddress(poolPda, tickArrayLowerStartIndex, program.programId)[0]
      const tickArrayUpper = getTickArrayAddress(poolPda, tickArrayUpperStartIndex, program.programId)[0]

      // @ts-ignore
      const instruction = await program.methods.increaseLiquidityV2(
        liquidity,
        amount0Max,
        amount1Max,
        null // base_flag
      ).accounts({
        nftOwner: publicKey,
        nftAccount: positionNftAccount,
        poolState: poolPda,
        protocolPosition: PublicKey.default,
        personalPosition: new PublicKey(position.positionPda),
        tickArrayLower,
        tickArrayUpper,
        tokenAccount0,
        tokenAccount1,
        tokenVault0: new PublicKey(pool.tokenVault0),
        tokenVault1: new PublicKey(pool.tokenVault1),
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
        vault0Mint: tokenMint0,
        vault1Mint: tokenMint1
      })

      const remainingAccounts = [];
      if (pool.rewardInfos) {
        for (const reward of pool.rewardInfos) {
          if (!reward.initialized) continue;
          const rewardMintKey = new PublicKey(reward.tokenMint);
          let tokenProgramId = TOKEN_PROGRAM_ID;
          try {
            const resp = await connection.getParsedAccountInfo(rewardMintKey);
            if (resp?.value?.owner) tokenProgramId = resp.value.owner;
          } catch (e) { }

          const rewardVault = getPoolRewardVaultAddress(poolPda, rewardMintKey, program.programId)[0];
          const userRewardAccount = getAssociatedTokenAddressSync(rewardMintKey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);

          remainingAccounts.push({ pubkey: rewardVault, isWritable: true, isSigner: false });
          remainingAccounts.push({ pubkey: userRewardAccount, isWritable: true, isSigner: false });
          remainingAccounts.push({ pubkey: rewardMintKey, isWritable: false, isSigner: false });
        }
      }

      if (remainingAccounts.length > 0) {
        instruction.remainingAccounts(remainingAccounts);
      }

      const ix = await instruction.instruction();

      const tx = new Transaction().add(ix)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      tx.feePayer = publicKey
      tx.recentBlockhash = blockhash

      const signedTx = await signTransaction(tx)
      const rawTransaction = signedTx.serialize()
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      })
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

      addTransaction(signature, `Increased liquidity in ${t0Name}/${t1Name}`)
      onSuccess()
      onClose()
    } catch (err: any) {
      console.error(err)
      let details = err.message || '';
      if (err.logs && Array.isArray(err.logs)) {
        details += '\n\nLogs:\n' + err.logs.join('\n');
      } else if (err.stack) {
        details += '\n\n' + err.stack;
      }

      let shortMessage = 'Failed to increase liquidity';
      if (err.message?.includes('User rejected')) {
        shortMessage = 'User rejected the request';
      } else if (err.message?.includes('Simulation failed') || err.message?.includes('simulation failed')) {
        shortMessage = 'Transaction simulation failed';
      }

      setTxState({ status: 'error', title: 'Transaction Failed', message: shortMessage, details });
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="portfolio-modal-overlay">
      <div className="portfolio-modal-backdrop" onClick={onClose} />
      <div className="portfolio-modal-content deposit-overlay">
        <button className="portfolio-modal-close" onClick={onClose}>✕</button>
        <div className="portfolio-modal-header">
          <h2>Add Liquidity to {t0Name} - {t1Name}</h2>
          <div className={`position-status-badge ${inRange ? 'in-range' : 'out-range'} position-badge-margin`}>
            <span className="status-dot"></span>{inRange ? 'In Range' : 'Out of Range'}
          </div>
          <div className="portfolio-modal-header-stats-grid">
            <div className="deposit-overlay-stat">
              <span className="deposit-overlay-label">Current position</span>
              <span className="deposit-overlay-value">{formatAmount(lowerPrice)} - {formatAmount(upperPrice)} {t1Name} per {t0Name}</span>
            </div>
            <div className="deposit-overlay-stat">
              <span className="deposit-overlay-label">Current Price</span>
              <span className="deposit-overlay-value">{formatAmount(currentPrice)} {t1Name} per {t0Name}</span>
            </div>
            <div className="deposit-overlay-stat">
              <span className="deposit-overlay-label">Deposit Ratio</span>
              <span className="deposit-overlay-value">{depositRatio}</span>
            </div>

          </div>
        </div>

        <div className="portfolio-modal-body">
          <div className={`deposit-token-card ${exceedBalance0 ? 'deposit-token-card-invalid' : ''}`} style={{ position: 'relative' }}>
            <div className={depositMode === 'token1Only' ? 'is-locked-blur' : ''}>
              <div className="deposit-token-top modal-token-top-between">
                <strong>{t0Name}</strong>
                <div className="deposit-balance-box">
                  <img src="/src/assets/wallet.svg" alt="wallet" className="wallet-icon" />
                  <span>{formatAmount(balance0)}</span>
                  <button className="deposit-quick-btn" onClick={() => { setActiveField('amount0'); setAmount0((balance0 * 0.5).toString()) }}>50%</button>
                  <button className="deposit-quick-btn" onClick={() => { setActiveField('amount0'); setAmount0(balance0.toString()) }}>MAX</button>
                </div>
              </div>
              <div className="deposit-token-row">
                <input
                  value={amount0}
                  onFocus={() => setActiveField('amount0')}
                  onChange={(e) => setAmount0(e.target.value)}
                  inputMode="decimal"
                  disabled={depositMode === 'token1Only'}
                  className={depositMode === 'token1Only' ? 'deposit-input-disabled' : ''}
                  placeholder="0.00"
                />
              </div>
            </div>
            {depositMode === 'token1Only' && (
              <div className="portfolio-token-locked-overlay">
                <div className="portfolio-token-locked-icon">
                  <img src="/src/assets/lock.svg" alt="locked" style={{ width: 24, height: 24, filter: 'invert(1)' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                  {!document.querySelector('img[src="/src/assets/lock.svg"]')}
                </div>
                <div className="portfolio-token-locked-title">Single asset deposit only.</div>
                <div className="portfolio-token-locked-desc">The market price is outside your specified price range.</div>
              </div>
            )}
          </div>

          <div className="deposit-plus modal-deposit-plus">+</div>

          <div className={`deposit-token-card ${exceedBalance1 ? 'deposit-token-card-invalid' : ''}`} style={{ position: 'relative' }}>
            <div className={depositMode === 'token0Only' ? 'is-locked-blur' : ''}>
              <div className="deposit-token-top modal-token-top-between">
                <strong>{t1Name}</strong>
                <div className="deposit-balance-box">
                  <img src="/src/assets/wallet.svg" alt="wallet" className="wallet-icon" />
                  <span>{formatAmount(balance1)}</span>
                  <button className="deposit-quick-btn" onClick={() => { setActiveField('amount1'); setAmount1((balance1 * 0.5).toString()) }}>50%</button>
                  <button className="deposit-quick-btn" onClick={() => { setActiveField('amount1'); setAmount1(balance1.toString()) }}>MAX</button>
                </div>
              </div>
              <div className="deposit-token-row">
                <input
                  value={amount1}
                  onFocus={() => setActiveField('amount1')}
                  onChange={(e) => setAmount1(e.target.value)}
                  inputMode="decimal"
                  disabled={depositMode === 'token0Only'}
                  className={depositMode === 'token0Only' ? 'deposit-input-disabled' : ''}
                  placeholder="0.00"
                />
              </div>
            </div>
            {depositMode === 'token0Only' && (
              <div className="portfolio-token-locked-overlay">
                <div className="portfolio-token-locked-icon">
                  <img src="/src/assets/lock.svg" alt="locked" style={{ width: 24, height: 24, filter: 'invert(1)' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                  {!document.querySelector('img[src="/src/assets/lock.svg"]')}
                </div>
                <div className="portfolio-token-locked-title">Single asset deposit only.</div>
                <div className="portfolio-token-locked-desc">The market price is outside your specified price range.</div>
              </div>
            )}
          </div>



          <div className="deposit-total-card modal-deposit-total">
            <span>Total Deposit</span>
            <strong>{formatAmount(a0Num)} {t0Name} + {formatAmount(a1Num)} {t1Name}</strong>
          </div>

          {txState && (
            <TxSmallCard
              status={txState.status}
              title={txState.title}
              description={txState.message}
              details={txState.details}
              signature={null}
              onClose={() => setTxState(null)}
            />
          )}

          <button
            className={`portfolio-btn modal-submit-btn ${exceedBalance ? 'insufficient-balance-btn' : ''}`}
            disabled={busy || isCalculating || depositTotal <= 0 || exceedBalance}
            onClick={handleDeposit}
          >
            {busy ? <span className="loader-dots">Processing...</span> : isCalculating ? <span className="loader-dots">Calculating...</span> : exceedBalance ? 'Insufficient balance' : 'Add Liquidity'}
          </button>
        </div>
      </div>
    </div>
  )
}

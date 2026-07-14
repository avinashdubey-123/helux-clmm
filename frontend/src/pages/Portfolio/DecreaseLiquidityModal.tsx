import React, { useState, useMemo } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PoolRowData } from '../../contexts/PoolsContext'
import { PositionRowData, getTokensFromLiquidity } from '../../hooks/usePositions'
import useProgram from '../../utils/useProgram'
import { useTransactions } from '../../contexts/TxContext'
import { getTickArrayAddress, getPoolRewardVaultAddress } from '../../utils/pda'
import TxSmallCard from '../../components/TxSmallCard/TxSmallCard'

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

export default function DecreaseLiquidityModal({ pool, position, onClose, onSuccess }: Props) {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  const program = useProgram()
  const { addTransaction } = useTransactions()

  const [percentage, setPercentage] = useState<number>(0)
  const [amount0Input, setAmount0Input] = useState<string>('')
  const [amount1Input, setAmount1Input] = useState<string>('')
  const [_activeField, setActiveField] = useState<'slider' | 'amount0' | 'amount1'>('slider')
  void _activeField
  const [busy, setBusy] = useState(false)
  const [txState, setTxState] = useState<{status: 'error', title: string, message: string, details?: string} | null>(null)

  const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase()
  const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase()

  const { amount0: maxAmount0, amount1: maxAmount1 } = useMemo(() => getTokensFromLiquidity(
    position.liquidity,
    position.tickLower,
    position.tickUpper,
    pool.tickCurrent,
    pool.mintDecimals0,
    pool.mintDecimals1
  ), [position, pool])

  const removeAmount0 = (maxAmount0 * percentage) / 100
  const removeAmount1 = (maxAmount1 * percentage) / 100

  // Check if manual input exceeds actual position liquidity with a small floating-point buffer
  const isAmount0Exceeded = Number(amount0Input) > maxAmount0 * 1.0001
  const isAmount1Exceeded = Number(amount1Input) > maxAmount1 * 1.0001
  const exceedLiquidity = isAmount0Exceeded || isAmount1Exceeded

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActiveField('slider')
    const newPct = Number(e.target.value)
    setPercentage(newPct)
    setAmount0Input(((maxAmount0 * newPct) / 100).toFixed(pool.mintDecimals0).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
    setAmount1Input(((maxAmount1 * newPct) / 100).toFixed(pool.mintDecimals1).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
  }

  const handleAmount0Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActiveField('amount0')
    const val = e.target.value
    setAmount0Input(val)
    const numVal = Number(val) || 0
    let pct = 0
    if (maxAmount0 > 0) {
      pct = Math.min(100, Math.max(0, (numVal / maxAmount0) * 100))
    } else if (maxAmount1 > 0) {
      pct = 0 // can't derive from amount0 if maxAmount0 is 0
    }
    setPercentage(pct)
    setAmount1Input(((maxAmount1 * pct) / 100).toFixed(pool.mintDecimals1).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
  }

  const handleAmount1Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActiveField('amount1')
    const val = e.target.value
    setAmount1Input(val)
    const numVal = Number(val) || 0
    let pct = 0
    if (maxAmount1 > 0) {
      pct = Math.min(100, Math.max(0, (numVal / maxAmount1) * 100))
    } else if (maxAmount0 > 0) {
      pct = 0
    }
    setPercentage(pct)
    setAmount0Input(((maxAmount0 * pct) / 100).toFixed(pool.mintDecimals0).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
  }

  const setMaxPercentage = (pct: number) => {
    setActiveField('slider')
    setPercentage(pct)
    setAmount0Input(((maxAmount0 * pct) / 100).toFixed(pool.mintDecimals0).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
    setAmount1Input(((maxAmount1 * pct) / 100).toFixed(pool.mintDecimals1).replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1'))
  }

  const handleWithdraw = async () => {
    if (!program || !publicKey || !signTransaction || percentage <= 0) return
    setTxState(null)
    setBusy(true)

    try {
      // Use high precision integer arithmetic to avoid truncation mismatches.
      // percentage can be a float like 12.34567% when derived from manual token amount inputs.
      // new BN() truncates floats, causing the smart contract to burn fewer tokens than visually expected,
      // which triggers the minimum bounds slippage error down the line. 
      const precisionPct = Math.floor(percentage * 1_000_000)
      const liquidityToRemove = new BN(position.liquidity).mul(new BN(precisionPct)).div(new BN(100_000_000))
      
      // Fetch mint accounts to calculate transfer fees
      const mint0Key = new PublicKey(pool.tokenMint0)
      const mint1Key = new PublicKey(pool.tokenMint1)

      const [mint0Info, mint1Info] = await Promise.all([
        connection.getAccountInfo(mint0Key),
        connection.getAccountInfo(mint1Key)
      ])

      let transferFee0 = 0
      let transferFee1 = 0
      const token2022ProgramId = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

      const grossAmount0 = Math.floor(removeAmount0 * 10 ** pool.mintDecimals0)
      if (mint0Info && mint0Info.owner.equals(token2022ProgramId) && mint0Info.data.length >= 82) {
        const feeBasisPoints = mint0Info.data.readUInt16LE(72)
        const maxFee = Number(mint0Info.data.readBigUInt64LE(74))
        if (feeBasisPoints > 0 && feeBasisPoints < 10000) {
          transferFee0 = Math.floor(grossAmount0 * feeBasisPoints / 10000)
        } else if (feeBasisPoints === 10000) {
          transferFee0 = maxFee
        }
      }

      const grossAmount1 = Math.floor(removeAmount1 * 10 ** pool.mintDecimals1)
      if (mint1Info && mint1Info.owner.equals(token2022ProgramId) && mint1Info.data.length >= 82) {
        const feeBasisPoints = mint1Info.data.readUInt16LE(72)
        const maxFee = Number(mint1Info.data.readBigUInt64LE(74))
        if (feeBasisPoints > 0 && feeBasisPoints < 10000) {
          transferFee1 = Math.floor(grossAmount1 * feeBasisPoints / 10000)
        } else if (feeBasisPoints === 10000) {
          transferFee1 = maxFee
        }
      }

      // Accounting for transfer fees + 5% slippage to absorb precise tick math mismatches.
      // The percentage offset handles large amounts, but for extremely low fractional withdrawals (e.g. < 8%),
      // 5% of a "dust" number is essentially 0 buffer, which causes rounding discrepancies to fail the contract.
      // We subtract an additional flat dust buffer (100 units) to guarantee safe slippage coverage.
      const slippageBuffer0 = Math.floor(grossAmount0 * 0.05)
      const slippageBuffer1 = Math.floor(grossAmount1 * 0.05)
      const flatDustBuffer = 100

      const amount0Min = new BN(Math.max(0, grossAmount0 - transferFee0 - slippageBuffer0 - flatDustBuffer))
      const amount1Min = new BN(Math.max(0, grossAmount1 - transferFee1 - slippageBuffer1 - flatDustBuffer))

      const poolPda = new PublicKey(pool.poolPda)
      const tickSpacing = pool.tickSpacing
      const adjustedLower = clampTick(position.tickLower, tickSpacing, 'down')
      const adjustedUpper = clampTick(position.tickUpper, tickSpacing, 'up')
      
      const tickArrayLowerStartIndex = tickArrayStartIndex(adjustedLower, tickSpacing)
      const tickArrayUpperStartIndex = tickArrayStartIndex(adjustedUpper, tickSpacing)

      const positionNftMint = new PublicKey(position.nftMint)
      const positionNftAccount = getAssociatedTokenAddressSync(positionNftMint, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
      const tokenMint0Key = new PublicKey(pool.tokenMint0)
      const tokenMint1Key = new PublicKey(pool.tokenMint1)
      let tokenProgram0Id = TOKEN_PROGRAM_ID
      let tokenProgram1Id = TOKEN_PROGRAM_ID
      try {
        const resp0 = await connection.getParsedAccountInfo(tokenMint0Key)
        if (resp0?.value?.owner) tokenProgram0Id = resp0.value.owner
      } catch (e) {}
      try {
        const resp1 = await connection.getParsedAccountInfo(tokenMint1Key)
        if (resp1?.value?.owner) tokenProgram1Id = resp1.value.owner
      } catch (e) {}

      const tokenAccount0 = getAssociatedTokenAddressSync(tokenMint0Key, publicKey, false, tokenProgram0Id, ASSOCIATED_TOKEN_PROGRAM_ID)
      const tokenAccount1 = getAssociatedTokenAddressSync(tokenMint1Key, publicKey, false, tokenProgram1Id, ASSOCIATED_TOKEN_PROGRAM_ID)
      
      const tickArrayLower = getTickArrayAddress(poolPda, tickArrayLowerStartIndex, program.programId)[0]
      const tickArrayUpper = getTickArrayAddress(poolPda, tickArrayUpperStartIndex, program.programId)[0]

      const instruction = await program.methods.decreaseLiquidityV2(
        liquidityToRemove,
        amount0Min,
        amount1Min
      ).accounts({
        nftOwner: publicKey,
        nftAccount: positionNftAccount,
        personalPosition: new PublicKey(position.positionPda),
        poolState: poolPda,
        protocolPosition: PublicKey.default,
        tokenVault0: new PublicKey(pool.tokenVault0),
        tokenVault1: new PublicKey(pool.tokenVault1),
        tickArrayLower,
        tickArrayUpper,
        recipientTokenAccount0: tokenAccount0,
        recipientTokenAccount1: tokenAccount1,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
        memoProgram: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        vault0Mint: tokenMint0Key,
        vault1Mint: tokenMint1Key
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
          } catch (e) {}

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
      
      addTransaction(signature, `Decreased liquidity in ${t0Name}/${t1Name} by ${percentage}%`)
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

      let shortMessage = 'Failed to decrease liquidity';
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
      <div className="portfolio-modal-content withdraw-overlay">
        <button className="portfolio-modal-close" onClick={onClose}>✕</button>
        <div className="portfolio-modal-header">
          <h2>Withdraw Liquidity from {t0Name} - {t1Name}</h2>
          <p className="modal-withdraw-subtitle">Select the amount of liquidity you wish to withdraw.</p>
        </div>

        <div className="portfolio-modal-body">
          <div className="withdraw-slider-container">
            <div className="withdraw-slider-header">
              <span>Amount</span>
              <span className="modal-withdraw-pct">{Math.round(percentage)}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="100" 
              step="0.1"
              value={percentage} 
              onChange={handleSliderChange}
              className="withdraw-slider"
              style={{ background: `linear-gradient(to right, #39d0d8 ${percentage}%, #1a2640 ${percentage}%)` }}
            />
            <div className="withdraw-slider-marks">
              <span onClick={() => setMaxPercentage(0)}>0%</span>
              <span onClick={() => setMaxPercentage(25)}>25%</span>
              <span onClick={() => setMaxPercentage(50)}>50%</span>
              <span onClick={() => setMaxPercentage(75)}>75%</span>
              <span onClick={() => setMaxPercentage(100)}>100%</span>
            </div>
          </div>

          <div className={`deposit-token-card modal-deposit-total ${isAmount0Exceeded ? 'deposit-token-card-invalid' : ''}`}>
            <div className="deposit-token-top modal-token-top-between">
              <strong>{t0Name}</strong>
            </div>
            <div className="deposit-token-row">
              <input
                value={amount0Input}
                onChange={handleAmount0Change}
                inputMode="decimal"
                disabled={maxAmount0 === 0}
                className={maxAmount0 === 0 ? 'deposit-input-disabled' : ''}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="deposit-plus modal-deposit-plus">+</div>

          <div className={`deposit-token-card ${isAmount1Exceeded ? 'deposit-token-card-invalid' : ''}`}>
            <div className="deposit-token-top modal-token-top-between">
              <strong>{t1Name}</strong>
            </div>
            <div className="deposit-token-row">
              <input
                value={amount1Input}
                onChange={handleAmount1Change}
                inputMode="decimal"
                disabled={maxAmount1 === 0}
                className={maxAmount1 === 0 ? 'deposit-input-disabled' : ''}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="modal-withdraw-amounts-card">
            <h3 className="modal-withdraw-amounts-title">You will receive</h3>
            <div className="modal-withdraw-amounts-row">
              <span>{formatAmount(removeAmount0)}</span>
              <strong>{t0Name}</strong>
            </div>
            <div className="modal-withdraw-amounts-row last">
              <span>{formatAmount(removeAmount1)}</span>
              <strong>{t1Name}</strong>
            </div>
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
            className={`portfolio-btn modal-submit-btn ${exceedLiquidity ? 'insufficient-balance-btn' : ''}`}
            disabled={busy || percentage <= 0 || exceedLiquidity} 
            onClick={handleWithdraw}
          >
            {busy ? <span className="loader-dots">Processing...</span> : exceedLiquidity ? 'Insufficient Liquidity' : 'Withdraw Liquidity'}
          </button>
        </div>
      </div>
    </div>
  )
}

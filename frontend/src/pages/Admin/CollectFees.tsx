/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token'
import useProgram from '../../utils/useProgram'
import { getShortTokenName } from '../../utils/token'
import { useTransactions } from '../../contexts/TxContext'
import TxSmallCard from '../../components/TxSmallCard/TxSmallCard'
import { callWithRetry } from '../../utils/batchFetch'
import './Admin.css'

const toPublicKey = (value?: string | any | null) => {
    if (!value) return null
    if (value instanceof PublicKey) return value
    try {
        if (typeof value === 'string') return new PublicKey(value)
        if (value.toBase58) {
            if (typeof value.toBase58 === 'function') return new PublicKey(value.toBase58())
            if (typeof value.toBase58 === 'string') return new PublicKey(value.toBase58)
        }
        if (value._bn) {
            const bnValue = value._bn.words || value._bn.hex || value._bn
            return new PublicKey(new anchor.BN(bnValue).toArray('le', 32))
        }
        const str = value.toString()
        if (str && str !== '[object Object]') return new PublicKey(str)
        return null
    } catch (e) {
        console.error('toPublicKey conversion failed:', e)
        return null
    }
}

const getBNValue = (val: any) => {
    if (!val) return new anchor.BN(0)
    if (typeof val === 'string' || typeof val === 'number') return new anchor.BN(val)
    if (val.toString && typeof val.toString === 'function' && val.toString() !== '[object Object]') {
        return new anchor.BN(val.toString())
    }
    if (val.words || val.hex) return new anchor.BN(val)
    return new anchor.BN(0)
}

export default function CollectFees() {
    const navigate = useNavigate()
    const location = useLocation()
    const wallet = useWallet()
    const { connection } = useConnection()
    const program = useProgram()
    const { addTransaction } = useTransactions()

    const state = location.state as { pool: any; type: 'protocol' | 'fund'; fromTab?: string }
    const [percent, setPercent] = useState(100)
    const [busy, setBusy] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [localPool, setLocalPool] = useState<any>(null)
    const [txState, setTxState] = useState<{
        status: 'success' | 'error' | 'info'
        title: string
        message: string
        signature?: string
        details?: string | null
    } | null>(null)
    const [collected, setCollected] = useState(false)

    const poolPdaStr = state?.pool?.publicKey || state?.pool?.poolPda
    const poolPda = useMemo(() => toPublicKey(poolPdaStr), [poolPdaStr])
    const type = state?.type || 'protocol'

    const fetchPool = useCallback(async () => {
        if (!program || !poolPda) return

        setFetching(true)
        try {
            await new Promise(r => setTimeout(r, 400))

            const data = await callWithRetry(() => (program.account as any).poolState.fetch(poolPda)) as any
            const p0 = data.protocolFeesToken0 ?? data.protocol_fees_token_0
            const p1 = data.protocolFeesToken1 ?? data.protocol_fees_token_1
            const f0 = data.fundFeesToken0 ?? data.fund_fees_token_0
            const f1 = data.fundFeesToken1 ?? data.fund_fees_token_1
            setLocalPool({
                ...state.pool,
                protocolFeesToken0: p0,
                protocolFeesToken1: p1,
                fundFeesToken0: f0,
                fundFeesToken1: f1,
                protocolFees0: p0,
                protocolFees1: p1,
                fundFees0: f0,
                fundFees1: f1,
            })
        } catch (err) {
            console.error('Fetch pool error:', err)
        } finally {
            setFetching(false)
        }
    }, [program, poolPda])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchPool()
    }, [fetchPool])

    if (!state || !state.pool || !poolPda) {
        return (
            <div className="collect-page">
                <div className="collect-card">
                    <h2>Error</h2>
                    <p>No pool selected for fee collection.</p>
                    <button className="collect-confirm" style={{ marginTop: '20px' }} onClick={() => navigate('/admin', { state: { activeTab: state?.fromTab } })}>Back to Admin</button>
                </div>
            </div>
        )
    }

    const pool = localPool || state.pool
    const fees0 = type === 'protocol'
        ? getBNValue(pool.protocolFeesToken0 || pool.protocolFees0)
        : getBNValue(pool.fundFeesToken0 || pool.fundFees0)
    const fees1 = type === 'protocol'
        ? getBNValue(pool.protocolFeesToken1 || pool.protocolFees1)
        : getBNValue(pool.fundFeesToken1 || pool.fundFees1)

    const dec0 = pool.mint0Decimals || 6
    const dec1 = pool.mint1Decimals || 6

    const amount0Available = Number(fees0.toString()) / Math.pow(10, dec0)
    const amount1Available = Number(fees1.toString()) / Math.pow(10, dec1)
    const t0Name = pool.token0Mint ? getShortTokenName(pool.token0Mint.toString()) : 'TOKEN0'
    const t1Name = pool.token1Mint ? getShortTokenName(pool.token1Mint.toString()) : 'TOKEN1'

    const onConfirmCollection = async () => {
        if (!program || !wallet.publicKey || !pool) return

        const amount0 = fees0.mul(new anchor.BN(percent)).div(new anchor.BN(100))
        const amount1 = fees1.mul(new anchor.BN(percent)).div(new anchor.BN(100))

        if (amount0.isZero() && amount1.isZero()) {
            setTxState({ status: 'error', title: 'Empty Collection', message: 'No fees available to collect at this time.' })
            return
        }

        setBusy(true)
        setTxState({ status: 'info', title: 'Preparing', message: 'Building transaction...' })

        try {
            const token0Mint = new PublicKey(pool.token0Mint.toString())
            const token1Mint = new PublicKey(pool.token1Mint.toString())

            let token0Program = TOKEN_PROGRAM_ID
            let token1Program = TOKEN_PROGRAM_ID
            const m0Account = await connection.getAccountInfo(token0Mint)
            const m1Account = await connection.getAccountInfo(token1Mint)
            if (m0Account) token0Program = m0Account.owner
            if (m1Account) token1Program = m1Account.owner

            const recipient0 = getAssociatedTokenAddressSync(token0Mint, wallet.publicKey, false, token0Program)
            const recipient1 = getAssociatedTokenAddressSync(token1Mint, wallet.publicKey, false, token1Program)

            const method = type === 'protocol' ? (program.methods as any).collectProtocolFee : (program.methods as any).collectFundFee

            const instructions = []
            instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }))
            // Optional: Set a baseline priority fee for better inclusion chances
            instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }))

            instructions.push(createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                recipient0,
                wallet.publicKey,
                token0Mint,
                token0Program,
                ASSOCIATED_TOKEN_PROGRAM_ID
            ))

            instructions.push(createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                recipient1,
                wallet.publicKey,
                token1Mint,
                token1Program,
                ASSOCIATED_TOKEN_PROGRAM_ID
            ))

            const ix = await method(amount0, amount1)
                .accounts({
                    owner: wallet.publicKey,
                    poolState: poolPda,
                    ammConfig: new PublicKey(pool.ammConfig.toString()),
                    tokenVault0: new PublicKey(pool.token0Vault.toString()),
                    tokenVault1: new PublicKey(pool.token1Vault.toString()),
                    vault0Mint: token0Mint,
                    vault1Mint: token1Mint,
                    recipientTokenAccount0: recipient0,
                    recipientTokenAccount1: recipient1,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    tokenProgram2022: TOKEN_2022_PROGRAM_ID,
                })
                .instruction()

            instructions.push(ix)

            setTxState({ status: 'info', title: 'Signing', message: 'Please confirm in your wallet' })

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

            const messageV0 = new anchor.web3.TransactionMessage({
                payerKey: wallet.publicKey,
                recentBlockhash: blockhash,
                instructions,
            }).compileToV0Message()

            const versionedTx = new anchor.web3.VersionedTransaction(messageV0)

            if (!wallet.signTransaction) {
                throw new Error("Wallet does not support manual signing.")
            }

            const signedTx = await wallet.signTransaction(versionedTx)
            setTxState({ status: 'info', title: 'Sending', message: 'Broadcasting to network...' })

            const sig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false })

            setTxState({ status: 'info', title: 'Confirming', message: 'Waiting for network confirmation...' })

            const confirmation = await connection.confirmTransaction({
                signature: sig,
                blockhash,
                lastValidBlockHeight
            }, 'confirmed')

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${confirmation.value.err}`)
            }

            fetchPool()

            setTxState({
                status: 'success',
                title: 'Success',
                message: 'Fees collected successfully',
                signature: sig
            })
            setCollected(true)
            addTransaction(sig, `Collected ${type} fees for ${t0Name}-${t1Name}`, 'Admin Action')
        } catch (err: any) {
            console.error('Fee collection error:', err)
            let details = err.message || String(err)
            if (err.logs && Array.isArray(err.logs)) {
                details += '\n\nLogs:\n' + err.logs.join('\n')
            } else if (err.simulationResponse?.logs) {
                details += '\n\nLogs:\n' + err.simulationResponse.logs.join('\n')
            }
            setTxState({
                status: 'error',
                title: 'Collection Failed',
                message: 'Transaction failed',
                details
            })
        } finally {
            setBusy(false)
        }
    }

    const formatAmount = (val: number) => val.toLocaleString(undefined, { maximumFractionDigits: 6 })

    const amount0ToCollect = amount0Available * percent / 100
    const amount1ToCollect = amount1Available * percent / 100

    return (
        <div className="portfolio-modal-overlay">
            <div className="portfolio-modal-backdrop" onClick={() => navigate('/admin', { state: { activeTab: state?.fromTab, refetchPools: collected } })} />
            <div className="portfolio-modal-content withdraw-overlay">
                <button className="portfolio-modal-close" onClick={() => navigate('/admin', { state: { activeTab: state?.fromTab, refetchPools: collected } })}>✕</button>
                <div className="portfolio-modal-header">
                    <h2>Collect {type === 'protocol' ? 'Protocol' : 'Fund'} Fees</h2>
                    <p className="modal-withdraw-subtitle">Pool: {poolPda.toBase58().slice(0, 12)}...</p>
                </div>

                <div className="portfolio-modal-body">
                    <div className="withdraw-slider-container">
                        <div className="withdraw-slider-header">
                            <span>Percentage</span>
                            <span className="modal-withdraw-pct">{Math.round(percent)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={percent}
                            onChange={(e) => setPercent(Number(e.target.value))}
                            className="withdraw-slider"
                            style={{ background: `linear-gradient(to right, #39d0d8 ${percent}%, #1a2640 ${percent}%)` }}
                        />
                        <div className="withdraw-slider-marks">
                            <span onClick={() => setPercent(0)}>0%</span>
                            <span onClick={() => setPercent(25)}>25%</span>
                            <span onClick={() => setPercent(50)}>50%</span>
                            <span onClick={() => setPercent(75)}>75%</span>
                            <span onClick={() => setPercent(100)}>100%</span>
                        </div>
                    </div>

                    <div className="deposit-token-card modal-deposit-total">
                        <div className="deposit-token-top modal-token-top-between">
                            <strong>{t0Name}</strong>
                        </div>
                        <div className="deposit-token-row" style={{ padding: '8px 0' }}>
                            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#e6f0ff' }}>
                                {fetching ? '...' : formatAmount(amount0ToCollect)}
                            </span>
                        </div>
                    </div>

                    <div className="deposit-plus modal-deposit-plus">+</div>

                    <div className="deposit-token-card modal-deposit-total">
                        <div className="deposit-token-top modal-token-top-between">
                            <strong>{t1Name}</strong>
                        </div>
                        <div className="deposit-token-row" style={{ padding: '8px 0' }}>
                            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#e6f0ff' }}>
                                {fetching ? '...' : formatAmount(amount1ToCollect)}
                            </span>
                        </div>
                    </div>

                    <div className="modal-withdraw-amounts-card" style={{ marginTop: '24px' }}>
                        <h3 className="modal-withdraw-amounts-title">Collection Summary</h3>
                        <div className="modal-withdraw-amounts-row last">
                            <span>Target</span>
                            <strong>{type === 'protocol' ? 'Protocol Treasury' : 'Fund Manager'}</strong>
                        </div>
                    </div>

                    {txState && (
                        <TxSmallCard
                            status={txState.status}
                            title={txState.title}
                            description={txState.message}
                            details={txState.details ?? undefined}
                            signature={txState.signature ?? null}
                            onClose={() => setTxState(null)}
                        />
                    )}

                    <button
                        className="portfolio-btn modal-submit-btn"
                        style={{ marginTop: '24px' }}
                        onClick={onConfirmCollection}
                        disabled={busy || fetching || (fees0.isZero() && fees1.isZero())}
                    >
                        {busy ? <span className="loader-dots">Processing...</span> : (fees0.isZero() && fees1.isZero() ? 'No Fees Available' : 'Confirm Collection')}
                    </button>
                </div>
            </div>
        </div>
    )
}

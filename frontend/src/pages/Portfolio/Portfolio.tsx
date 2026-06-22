import { useState, useMemo } from 'react'
import './Portfolio.css'
import { usePositions, getTokensFromLiquidity, PositionRowData } from '../../hooks/usePositions'
import { usePools, PoolRowData } from '../../contexts/PoolsContext'
import { useTransactions } from '../../contexts/TxContext'
import Loader from '../../components/Loader/Loader'
import IncreaseLiquidityModal from './IncreaseLiquidityModal'
import DecreaseLiquidityModal from './DecreaseLiquidityModal'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import useProgram from '../../utils/useProgram'

function addressToColor(addr: string) {
  const hash = addr.split('').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0)
  const hue = hash % 360
  return `hsl(${hue},70%,58%)`
}

function tickToPrice(tick: number) {
  return Math.pow(1.0001, tick)
}

function formatAmount(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

export default function Portfolio() {
  const { positions, loadingPositions, positionsError, refreshPositions } = usePositions()
  const { pools, loadingPools } = usePools()
  const { transactions, addTransaction } = useTransactions()
  const [activeTab, setActiveTab] = useState<'invested' | 'liquidity' | 'activity'>('liquidity')
  const [searchQuery, setSearchQuery] = useState('')

  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  const program = useProgram()

  const [activeModal, setActiveModal] = useState<'increase' | 'decrease' | null>(null)
  const [selectedPosition, setSelectedPosition] = useState<{ pool: PoolRowData; position: PositionRowData } | null>(null)
  const [busyClosing, setBusyClosing] = useState<string | null>(null)

  const poolsById = useMemo(() => {
    const map = new Map<string, PoolRowData>()
    pools.forEach(p => map.set(p.poolPda, p))
    return map
  }, [pools])

  // Group positions by pool
  const groupedPositions = useMemo(() => {
    const groups = new Map<string, PositionRowData[]>()
    positions.forEach(pos => {
      if (!groups.has(pos.poolId)) {
        groups.set(pos.poolId, [])
      }
      groups.get(pos.poolId)!.push(pos)
    })
    return groups
  }, [positions])

  const filteredPools = useMemo(() => {
    const query = searchQuery.toLowerCase()
    return Array.from(groupedPositions.keys()).filter(poolId => {
      const pool = poolsById.get(poolId)
      if (!pool) return false
      const name = `${pool.tokenMint0.slice(0, 4)}-${pool.tokenMint1.slice(0, 4)}`.toLowerCase()
      return (
        poolId.toLowerCase().includes(query) ||
        name.includes(query) ||
        pool.tokenMint0.toLowerCase().includes(query) ||
        pool.tokenMint1.toLowerCase().includes(query)
      )
    })
  }, [groupedPositions, poolsById, searchQuery])

  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set())
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set())

  const togglePosition = (posId: string) => {
    setExpandedPositions(prev => {
      const next = new Set(prev)
      if (next.has(posId)) next.delete(posId)
      else next.add(posId)
      return next
    })
  }

  const togglePool = (poolId: string) => {
    setExpandedPools(prev => {
      const next = new Set(prev)
      if (next.has(poolId)) {
        next.delete(poolId)
      } else {
        next.add(poolId)
      }
      return next
    })
  }

  // Stats for Invested Assets
  const tokenStats = useMemo(() => {
    const tokens = new Map<string, Set<string>>() // tokenName -> Set of poolIds
    positions.forEach(pos => {
      const pool = poolsById.get(pos.poolId)
      if (pool) {
        const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase()
        const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase()

        if (!tokens.has(t0Name)) tokens.set(t0Name, new Set())
        if (!tokens.has(t1Name)) tokens.set(t1Name, new Set())

        tokens.get(t0Name)!.add(pos.poolId)
        tokens.get(t1Name)!.add(pos.poolId)
      }
    })
    return Array.from(tokens.entries()).map(([tokenName, poolsSet]) => ({
      tokenName,
      poolCount: poolsSet.size
    }))
  }, [positions, poolsById])

  const isLoading = loadingPositions || loadingPools

  const handleInvestedPoolClick = (tokenName: string) => {
    setSearchQuery(tokenName)
    setActiveTab('liquidity')
  }

  const handleClosePosition = async (pos: PositionRowData, pool: PoolRowData) => {
    if (!program || !publicKey || !signTransaction) return
    setBusyClosing(pos.positionPda)

    const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase()
    const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase()

    try {
      const positionNftMint = new PublicKey(pos.nftMint)
      const positionNftAccount = getAssociatedTokenAddressSync(positionNftMint, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)

      // @ts-ignore
      const instruction = await program.methods.closePosition().accounts({
        nftOwner: publicKey,
        positionNftMint,
        positionNftAccount,
        personalPosition: new PublicKey(pos.positionPda),
        systemProgram: PublicKey.default, // Used for closing accounts, wait, it's SystemProgram.programId
        tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction()

      // Fix system program
      const ix = { ...instruction }
      ix.keys = ix.keys.map(k => k.pubkey.equals(PublicKey.default) ? { ...k, pubkey: new PublicKey('11111111111111111111111111111111') } : k)

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

      addTransaction(signature, `Closed position for ${t0Name}/${t1Name}`)
      refreshPositions()
    } catch (err: any) {
      console.error('Failed to close position', err)
      alert(err.message || 'Failed to close position')
    } finally {
      setBusyClosing(null)
    }
  }

  return (
    <div className="portfolio-page">
      <div className="portfolio-hero">
        <h1 className="portfolio-title">Portfolio</h1>
        <p className="portfolio-subtitle">Manage and track your liquidity pools, tokens, and recent activities.</p>
      </div>

      <div className="portfolio-tabs-container">
        <div className="portfolio-tabs">
          <button
            className={`portfolio-tab ${activeTab === 'invested' ? 'active' : ''}`}
            onClick={() => setActiveTab('invested')}
          >
            Invested Assets
          </button>
          <button
            className={`portfolio-tab ${activeTab === 'liquidity' ? 'active' : ''}`}
            onClick={() => setActiveTab('liquidity')}
          >
            My Liquidity
          </button>
          <button
            className={`portfolio-tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            Activity
          </button>
        </div>
      </div>

      {activeTab === 'invested' && (
        <div className="portfolio-invested-tab">
          <div className="portfolio-summary-card">
            <h3 className="portfolio-tokens-header">Invested Assets</h3>
            <div className="portfolio-tokens-list">
              {tokenStats.length === 0 ? (
                <div className="portfolio-empty-state">No tokens invested yet.</div>
              ) : (
                tokenStats.map(stat => (
                  <div key={stat.tokenName} className="portfolio-token-row">
                    <div className="token-row-left">
                      <div className="pool-icon" style={{ background: addressToColor(stat.tokenName) }}>
                        {stat.tokenName.slice(0, 2)}
                      </div>
                      <strong className="token-name-strong">{stat.tokenName}</strong>
                    </div>
                    <div className="token-row-right">
                      <button
                        className="token-pools-link"
                        onClick={() => handleInvestedPoolClick(stat.tokenName)}
                      >
                        {stat.poolCount} {stat.poolCount === 1 ? 'pool' : 'pools'} invested &rarr;
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="portfolio-activity-tab">
          <div className="portfolio-summary-card">
            <h2>Session Transactions</h2>
            <div className="portfolio-tx-list">
              {transactions.length === 0 ? (
                <p className="portfolio-empty-activity">No recent activity found.</p>
              ) : (
                transactions.map(tx => (
                  <div key={tx.signature} className="portfolio-tx-row">
                    <div className="tx-info">
                      <span className="tx-desc">{tx.description}</span>
                      <span className="tx-time">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <a
                      href={`https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="tx-link"
                    >
                      Open with Explorer
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'liquidity' && (
        <div className="portfolio-liquidity-tab">
          <div className="portfolio-search-bar">
            <input
              type="text"
              placeholder="Search by token symbol, pair name, or pool address..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="portfolio-pools-list">
            {isLoading ? (
              <div className="portfolio-loader-container">
                <Loader size={36} />
              </div>
            ) : positionsError ? (
              <div className="portfolio-error-container">
                Error loading positions: {positionsError}
              </div>
            ) : filteredPools.length === 0 ? (
              <div className="portfolio-empty-container">
                No positions found.
              </div>
            ) : (
              filteredPools.map(poolId => {
                const pool = poolsById.get(poolId)
                if (!pool) return null

                const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase()
                const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase()
                const t0Color = addressToColor(pool.tokenMint0)
                const t1Color = addressToColor(pool.tokenMint1)

                const isExpanded = expandedPools.has(poolId)
                const poolPositions = groupedPositions.get(poolId) || []

                return (
                  <div key={poolId} className="portfolio-pool-card">
                    <div
                      className="portfolio-pool-header pool-header-clickable"
                      onClick={() => togglePool(poolId)}
                    >
                      <div className="pool-header-left">
                        <div className="pool-icons">
                          <div className="pool-icon pool-icon-primary" style={{ background: t0Color }}>{t0Name.slice(0, 2)}</div>
                          <div className="pool-icon pool-icon-secondary" style={{ background: t1Color }}>{t1Name.slice(0, 2)}</div>
                        </div>
                        <h3 className="pool-name">{t0Name} / {t1Name}</h3>
                        <span className="pool-positions-count">
                          {poolPositions.length} position{poolPositions.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="pool-header-right">
                        <span className={`pool-chevron ${isExpanded ? 'expanded' : ''}`}>
                          &#9662;
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="portfolio-positions-list portfolio-positions-list-expanded">
                        {poolPositions.map(pos => {
                          const currentTick = pool.tickCurrent
                          const lowerPrice = tickToPrice(pos.tickLower)
                          const upperPrice = tickToPrice(pos.tickUpper)
                          const inRange = currentTick >= pos.tickLower && currentTick <= pos.tickUpper

                          const { amount0, amount1 } = getTokensFromLiquidity(
                            pos.liquidity,
                            pos.tickLower,
                            pos.tickUpper,
                            currentTick,
                            pool.mintDecimals0,
                            pool.mintDecimals1
                          )

                          const isPosExpanded = expandedPositions.has(pos.positionPda)

                          return (
                            <div key={pos.positionPda} className="portfolio-position-card">
                              <div
                                className="portfolio-position-summary"
                                onClick={() => togglePosition(pos.positionPda)}
                              >
                                <div className="position-status-container">
                                  <span className={`position-status-badge ${inRange ? 'in-range' : 'out-range'}`}>
                                    <span className="status-dot"></span>
                                    {inRange ? 'In Range' : 'Out of Range'}
                                  </span>
                                  <span className="position-range-text">
                                    {formatAmount(lowerPrice)} - {formatAmount(upperPrice)} {t1Name} per {t0Name}
                                  </span>
                                </div>

                                <div className="position-amounts-center">
                                  <span>{formatAmount(amount0)} {t0Name}</span>
                                  <span className="position-amount-divider">|</span>
                                  <span>{formatAmount(amount1)} {t1Name}</span>
                                </div>

                                <div className="position-actions-right">
                                  <button className="pos-btn pos-btn-deposit" onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedPosition({ pool, position: pos })
                                    setActiveModal('increase')
                                  }}>+</button>
                                  <button className="pos-btn pos-btn-withdraw" onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedPosition({ pool, position: pos })
                                    setActiveModal('decrease')
                                  }}>-</button>
                                  <span className={`position-chevron ${isPosExpanded ? 'expanded' : ''}`}>
                                    &#9662;
                                  </span>
                                </div>
                              </div>

                              {isPosExpanded && (
                                <div className="portfolio-position-details">
                                  <div className="pos-details-left">
                                    <div className="pos-details-label">Unclaimed Fees</div>
                                    <div className="pos-details-value">0.00 {t0Name} | 0.00 {t1Name}</div>
                                  </div>
                                  <div className="pos-details-right">
                                    <button
                                      className={`pos-btn btn-close-position ${pos.liquidity !== '0' ? 'locked' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (pos.liquidity === '0') handleClosePosition(pos, pool);
                                      }}
                                      disabled={busyClosing === pos.positionPda || pos.liquidity !== '0'}
                                      title={pos.liquidity !== '0' ? "Withdraw all liquidity before closing" : ""}
                                    >
                                      {busyClosing === pos.positionPda ? 'Closing...' : 'Close Position'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {activeModal === 'increase' && selectedPosition && (
        <IncreaseLiquidityModal
          pool={selectedPosition.pool}
          position={selectedPosition.position}
          onClose={() => { setActiveModal(null); setSelectedPosition(null) }}
          onSuccess={() => { refreshPositions() }}
        />
      )}

      {activeModal === 'decrease' && selectedPosition && (
        <DecreaseLiquidityModal
          pool={selectedPosition.pool}
          position={selectedPosition.position}
          onClose={() => { setActiveModal(null); setSelectedPosition(null) }}
          onSuccess={() => { refreshPositions() }}
        />
      )}
    </div>
  )
}
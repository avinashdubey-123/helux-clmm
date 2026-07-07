/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import useProgram from '../../utils/useProgram'
import TxSmallCard from '../../components/TxSmallCard/TxSmallCard'
import { callWithRetry } from '../../utils/batchFetch'
import { getAmmConfigAddress, getOperationAccountAddress, getSupportMintAssociatedAddress } from '../../utils/pda'
import copyIcon from '../../assets/copy.svg'
import './Admin.css'
import { getShortTokenName, getPoolDisplayName } from '../../utils/token'
import { useTransactions } from '../../contexts/TxContext'


const ADMIN_ID = new PublicKey('wE2EtwuovRxvXZoThsXhRTuCrFdAA1jTbLnJp9nfezL')
const DEFAULT_PUBKEY = '11111111111111111111111111111111'

// Module-level cache to persist data across page navigations without Redux bloat or serialization issues
let cachedConfigs: Record<string, any>[] | null = null
let cachedSupportMints: Record<string, any>[] | null = null
let cachedOperationAccount: Record<string, any> | null = null
let cachedPools: Record<string, any>[] | null = null
let initialFetchStarted = false

function getTokenColor(symbol: string): string {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 40%)`
}

function PoolDisplay({ poolAddr, token0, token1 }: { poolAddr: string; token0?: string; token1?: string }) {
  const [hoverInfo, setHoverInfo] = useState<{ poolId?: string | null; token0?: string | null; token1?: string | null } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const hoverTimeout = useRef<number | null>(null)
  const clearHoverTimeout = () => {
    if (hoverTimeout.current != null) {
      clearTimeout(hoverTimeout.current)
      hoverTimeout.current = null
    }
  }

  const handleIconHover = () => {
    clearHoverTimeout()
    setHoverInfo({ poolId: poolAddr, token0, token1 })
  }

  const handleIconLeave = () => {
    clearHoverTimeout()
    hoverTimeout.current = window.setTimeout(() => setHoverInfo(null), 150)
  }

  const copyText = async (value?: string | null, key = value ?? '') => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      /* clipboard write may fail silently */
    }
  }

  const name0 = token0 ? getShortTokenName(token0) : 'UNKN'
  const name1 = token1 ? getShortTokenName(token1) : 'UNKN'
  let displayName = getPoolDisplayName(token0, token1)
  if (token0 && token1) {
    const t0Pub = new PublicKey(token0)
    const t1Pub = new PublicKey(token1)
    if (Buffer.compare(t0Pub.toBuffer(), t1Pub.toBuffer()) > 0) {
      displayName = getPoolDisplayName(token1, token0)
    }
  }

  const getIconLabel = (symbol: string) => symbol.slice(0, 2).toUpperCase()

  const color0 = getTokenColor(name0)
  const color1 = getTokenColor(name1)

  return (
    <div className="lp-td-pool-inner" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: 0, justifyContent: 'flex-start' }}>
      <div className="lp-hover-wrapper" onMouseEnter={handleIconHover} onMouseLeave={handleIconLeave} style={{ display: 'inline-block', position: 'relative' }}>
        <div className="lp-pool-icons" style={{ cursor: 'pointer', display: 'flex' }} title="Hover to view pool info">
          <span className="lp-icon lp-icon-a" style={{ background: color0, zIndex: 1 }}>
            {getIconLabel(name0)}
          </span>
          <span className="lp-icon lp-icon-b" style={{ background: color1 }}>
            {getIconLabel(name1)}
          </span>
        </div>
        {hoverInfo && (
          <div className="lp-hover-card">
            <div className="lp-hover-row">
              <span><strong>Pool id:</strong> {hoverInfo.poolId ?? 'unknown'}</span>
              <button className="lp-copy-btn" onClick={(e) => { e.stopPropagation(); copyText(hoverInfo.poolId, 'pool') }} title="Copy pool id">
                {copiedKey === 'pool' ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
              </button>
            </div>
            <div className="lp-hover-row">
              <span><strong>token0:</strong> {hoverInfo.token0 ?? '-'}</span>
              <button className="lp-copy-btn" onClick={(e) => { e.stopPropagation(); copyText(hoverInfo.token0, 'token0') }} title="Copy token0">
                {copiedKey === 'token0' ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
              </button>
            </div>
            <div className="lp-hover-row">
              <span><strong>token1:</strong> {hoverInfo.token1 ?? '-'}</span>
              <button className="lp-copy-btn" onClick={(e) => { e.stopPropagation(); copyText(hoverInfo.token1, 'token1') }} title="Copy token1">
                {copiedKey === 'token1' ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="lp-pool-info" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="lp-pool-name" style={{ fontWeight: 600, fontSize: '14px', color: '#fff', textAlign: 'left' }}>{displayName}</span>
      </div>
    </div>
  )
}

/** Shortened address with copy button and hover card – same pattern as Liquidity page */
function AdminAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(address) } catch {
      /* clipboard write may fail silently */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const short = `${address.slice(0, 6)}...${address.slice(-6)}`

  return (
    <span
      className="admin-addr-wrapper"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span className="admin-addr-short" title={address}>{short}</span>
      <button className="admin-copy-btn" onClick={copy} title="Copy address" aria-label="Copy address">
        {copied ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" style={{ width: 12, height: 12, opacity: 0.7 }} />}
      </button>
    </span>
  )
}

const Admin = () => {
  const program = useProgram()
  const wallet = useWallet()
  const { connection } = useConnection()
  const { addTransaction } = useTransactions()

  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTabState] = useState<'config' | 'operation' | 'token2022' | 'pools' | 'fees'>(() => {
    return (sessionStorage.getItem('adminTab') as any) || 'config'
  })

  const setActiveTab = (tab: 'config' | 'operation' | 'token2022' | 'pools' | 'fees') => {
    sessionStorage.setItem('adminTab', tab)
    setActiveTabState(tab)
  }
  const [loading, setLoading] = useState(false)
  const [errorState, setErrorState] = useState<{ title?: string; message: string; details?: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [txResult, setTxResult] = useState<{ sig: string; explorer: string } | null>(null)

  const [configs, setConfigs] = useState<any[]>(() => cachedConfigs || [])
  const [supportMintAssociatedAccounts, setSupportMintAssociatedAccounts] = useState<any[]>(() => cachedSupportMints || [])
  const [operationAccount, setOperationAccount] = useState<any | null>(() => cachedOperationAccount || null)
  const [operationAccountExists, setOperationAccountExists] = useState<boolean>(() => !!cachedOperationAccount)
  const [supportMint, setSupportMint] = useState('')
  const [copiedMint, setCopiedMint] = useState<string | null>(null)
  const [operationOwnerInput, setOperationOwnerInput] = useState('')
  const [whitelistMintInput, setWhitelistMintInput] = useState('')
  // Form states (only create AMM config is enabled)
  const [configIndex, setConfigIndex] = useState('0')
  const [tickSpacing, setTickSpacing] = useState('60')
  const [tradeFee, setTradeFee] = useState('2500')
  const [protocolFee, setProtocolFee] = useState('120000')
  const [fundFee, setFundFee] = useState('40000')

  const [expandedConfigs, setExpandedConfigs] = useState<Set<string>>(new Set())
  const [updateParams, setUpdateParams] = useState<Record<string, string>>({})
  const [updateValues, setUpdateValues] = useState<Record<string, string>>({})

  // Pool state management
  const [pools, setPools] = useState<any[]>(() => cachedPools || [])
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set())
  const [poolStatusChanges, setPoolStatusChanges] = useState<Record<string, number>>({})

  const getOperationState = async () => {
    if (!program) return

    const [operationState] = getOperationAccountAddress(program.programId)
    const namespace = (program.account as any).operationState

    if (!namespace) {
      setOperationAccount(null)
      setOperationAccountExists(false)
      cachedOperationAccount = null
      return
    }

    try {
      const account = typeof namespace.fetchNullable === 'function'
        ? await callWithRetry(() => namespace.fetchNullable(operationState) as Promise<any>)
        : await callWithRetry(() => namespace.fetch(operationState) as Promise<any>)

      setOperationAccount(account)
      setOperationAccountExists(Boolean(account))
      cachedOperationAccount = account
    } catch {
      setOperationAccount(null)
      setOperationAccountExists(false)
      cachedOperationAccount = null
    }
  }

  const fetchData = async () => {
    if (!program) return
    // Only show loading spinner if we don't have cached data to show immediately
    if (!cachedConfigs) setLoading(true)
    try {
      // Fetch Configs
      const configNamespace = (program.account as any).ammConfig
      const loadedConfigs = await callWithRetry(() => configNamespace.all() as Promise<any[]>)
      const mappedConfigs = loadedConfigs.map((c: any) => ({ ...c.account, publicKey: c.publicKey }))
      setConfigs(mappedConfigs)
      cachedConfigs = mappedConfigs

      // Fetch approved support mints if namespace exists
      const supportMintNamespace = (program.account as any).supportMintAssociated
      if (supportMintNamespace && typeof supportMintNamespace.all === 'function') {
        const loadedSupportMints = await callWithRetry(() => supportMintNamespace.all() as Promise<any[]>)
        const mappedMints = loadedSupportMints.map((e: any) => ({ ...e.account, publicKey: e.publicKey }))
        setSupportMintAssociatedAccounts(mappedMints)
        cachedSupportMints = mappedMints
      }

      // Fetch Pools
      const poolNamespace = (program.account as any).poolState
      if (poolNamespace && typeof poolNamespace.all === 'function') {
        const loadedPools = await callWithRetry(() => poolNamespace.all() as Promise<any[]>)
        const mappedPools = loadedPools.map((p: any) => ({ ...p.account, publicKey: p.publicKey }))
        setPools(mappedPools)
        cachedPools = mappedPools
      }

      await getOperationState()

    } catch (err: any) {
      console.error('Fetch error:', err)
      setErrorState({ message: 'Failed to fetch admin data', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  // Initialize data on program load - only once
  useEffect(() => {
    if (!program) return
    if (!initialFetchStarted) {
      initialFetchStarted = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program])

  // Refetch pools when returning from CollectFees after a successful collection
  useEffect(() => {
    const navState = location.state as any
    if (navState?.refetchPools && program) {
      const refetchPools = async () => {
        try {
          const poolNamespace = (program.account as any).poolState
          if (poolNamespace && typeof poolNamespace.all === 'function') {
            const loadedPools = await callWithRetry(() => poolNamespace.all() as Promise<any[]>)
            const mappedPools = loadedPools.map((p: any) => ({ ...p.account, publicKey: p.publicKey }))
            setPools(mappedPools)
            cachedPools = mappedPools
          }
        } catch (err) {
          console.error('Pool refetch error:', err)
        }
      }
      refetchPools()
      // Clear the flag so it doesn't refetch again on re-render
      window.history.replaceState({ ...navState, refetchPools: false }, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, program])

  const parsePubkeyList = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => new PublicKey(item))

  const isValidAddressList = (value: string) => {
    const v = (value || '').trim()
    if (!v) return false
    try {
      const keys = parsePubkeyList(v)
      return keys.length > 0
    } catch {
      return false
    }
  }

  const handleCreateOperationAccount = async () => {
    if (!program || !wallet.publicKey) return

    setLoading(true)
    setErrorState(null)
    setSuccess(null)
    try {
      const [operationState] = getOperationAccountAddress(program.programId)
      const sig = await (program.methods as any)
        .createOperationAccount()
        .accounts({
          owner: wallet.publicKey,
          operationState,
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      await connection.confirmTransaction(sig, 'confirmed')
      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess('Operation account created successfully')
      addTransaction(sig, 'Operation account created successfully', 'Admin Action', true)
      await getOperationState()
    } catch (err: any) {
      setErrorState({ message: 'Failed to create operation account', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateOperationAccount = async (param: number, rawInput: string, clearInput: () => void, successMessage: string) => {
    if (!program || !wallet.publicKey) return

    try {
      const keys = parsePubkeyList(rawInput)

      if (keys.length === 0) {
        setErrorState({ message: 'Enter at least one address' })
        return
      }

      setLoading(true)
      setErrorState(null)
      setSuccess(null)

      const [operationState] = getOperationAccountAddress(program.programId)
      const sig = await (program.methods as any)
        .updateOperationAccount(param, keys)
        .accounts({
          owner: wallet.publicKey,
          operationState,
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      await connection.confirmTransaction(sig, 'confirmed')
      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(successMessage)
      addTransaction(sig, successMessage, 'Admin Action', true)
      clearInput()
      await getOperationState()
    } catch (err: any) {
      setErrorState({ message: 'Failed to update operation account', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateConfig = async () => {
    if (!program || !wallet.publicKey) return
    setLoading(true)
    setErrorState(null)
    setSuccess(null)
    try {
      const index = parseInt(configIndex)
      const tick = parseInt(tickSpacing)
      const [ammConfig] = getAmmConfigAddress(index, program.programId)

      const sig = await (program.methods as any)
        .createAmmConfig(
          index,
          new anchor.BN(tick),
          new anchor.BN(tradeFee),
          new anchor.BN(protocolFee),
          new anchor.BN(fundFee),
        )
        .accounts({
          owner: wallet.publicKey,
          ammConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      await connection.confirmTransaction(sig, 'confirmed')
      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(`Config ${index} created successfully`)
      addTransaction(sig, `Config ${index} created successfully`, 'Admin Action', true)
      fetchData()
    } catch (err: any) {
      setErrorState({ message: 'Failed to create config', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateAmmConfig = async (configAddr: PublicKey) => {
    if (!program || !wallet.publicKey) return
    const addrStr = configAddr.toBase58()
    const updateParam = updateParams[addrStr] ?? '0'
    const updateValue = updateValues[addrStr] ?? ''

    setLoading(true)
    setErrorState(null)
    setSuccess(null)
    try {
      const paramNum = parseInt(updateParam)
      let value: any;

      const remainingAccounts = []
      if (paramNum === 3 || paramNum === 4) {
        remainingAccounts.push({
          pubkey: new PublicKey(updateValue),
          isWritable: false,
          isSigner: false,
        })
        value = new anchor.BN(0)
      } else {
        value = new anchor.BN(updateValue)
      }

      const sig = await (program.methods as any)
        .updateAmmConfig(paramNum, value)
        .accounts({
          owner: wallet.publicKey,
          ammConfig: configAddr,
        })
        .remainingAccounts(remainingAccounts)
        .rpc()

      await connection.confirmTransaction(sig, 'confirmed')
      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(`Amm Config updated successfully`)
      addTransaction(sig, `Amm Config updated successfully`, 'Admin Action', true)
      setUpdateValues(prev => ({ ...prev, [addrStr]: '' }))
      fetchData()
    } catch (err: any) {
      setErrorState({ message: 'Failed to update config', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSupportMintAssociated = async () => {
    if (!program || !wallet.publicKey) return
    if (!supportMint) {
      setErrorState({ message: 'Enter a token-2022 mint address first' })
      return
    }

    setLoading(true)
    setErrorState(null)
    setSuccess(null)
    try {
      const mint = new PublicKey(supportMint)
      const [supportMintAssociated] = getSupportMintAssociatedAddress(mint, program.programId)

      const sig = await (program.methods as any)
        .createSupportMintAssociated()
        .accounts({
          owner: wallet.publicKey,
          tokenMint: mint,
          supportMintAssociated,
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      await connection.confirmTransaction(sig, 'confirmed')
      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess('Support mint approved successfully')
      addTransaction(sig, 'Support mint approved successfully', 'Admin Action', true)
      setSupportMint('')
      fetchData()
    } catch (err: any) {
      setErrorState({ message: 'Failed to approve support mint', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  const handleCopyMintAddress = async (mintAddress: string) => {
    try {
      await navigator.clipboard.writeText(mintAddress)
      setCopiedMint(mintAddress)
      window.setTimeout(() => {
        setCopiedMint((current) => (current === mintAddress ? null : current))
      }, 1200)
    } catch (err) {
      console.error('Failed to copy mint address:', err)
      setErrorState({ message: 'Failed to copy mint address' })
    }
  }

  // Pool status management
  const togglePoolExpansion = (poolAddr: string, currentStatus: number) => {
    const newExpanded = new Set(expandedPools)
    if (newExpanded.has(poolAddr)) {
      newExpanded.delete(poolAddr)
    } else {
      newExpanded.add(poolAddr)
      if (poolStatusChanges[poolAddr] === undefined) {
        setPoolStatusChanges(prev => ({ ...prev, [poolAddr]: currentStatus }))
      }
    }
    setExpandedPools(newExpanded)
  }

  const handleBitToggle = (poolAddr: string, bitValue: number) => {
    const currentPending = poolStatusChanges[poolAddr] ?? 0
    const newStatus = currentPending ^ bitValue
    setPoolStatusChanges(prev => ({ ...prev, [poolAddr]: newStatus }))
  }

  const handleUpdatePoolStatus = async (pool: any) => {
    if (!program || !wallet.publicKey) return
    const poolAddr = pool.publicKey.toBase58()
    const status = poolStatusChanges[poolAddr] ?? pool.status
    setLoading(true)
    setErrorState(null)
    setSuccess(null)
    try {
      const sig = await (program.methods as any)
        .updatePoolStatus(status)
        .accounts({
          authority: wallet.publicKey,
          poolState: pool.publicKey,
        })
        .rpc()

      await connection.confirmTransaction(sig, 'confirmed')
      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(`Pool ${poolAddr} status updated to ${status}`)
      addTransaction(sig, `Pool ${poolAddr} status updated to ${status}`, 'Admin Action', true)
      fetchData()

      setPoolStatusChanges(prev => {
        const next = { ...prev }
        delete next[poolAddr]
        return next
      })
      setExpandedPools(prev => {
        const next = new Set(prev)
        next.delete(poolAddr)
        return next
      })
    } catch (err: any) {
      setErrorState({ message: 'Failed to update pool status', details: err.message || err.toString() })
    } finally {
      setLoading(false)
    }
  }

  const operationOwners = ((operationAccount?.operationOwners ?? operationAccount?.operation_owners) || [])
    .filter((key: any) => key && key.toBase58 && key.toBase58() !== DEFAULT_PUBKEY)
    .map((key: any) => key.toBase58())

  const whitelistMints = ((operationAccount?.whitelistMints ?? operationAccount?.whitelist_mints) || [])
    .filter((key: any) => key && key.toBase58 && key.toBase58() !== DEFAULT_PUBKEY)
    .map((key: any) => key.toBase58())

  const isAdmin = wallet.publicKey?.equals(ADMIN_ID)

  if (!wallet.connected) {
    return <div className="admin-page">Please connect your wallet</div>
  }

  if (!isAdmin && wallet.publicKey) {
    return <div className="admin-page">Access Denied. You are not the admin.</div>
  }

  return (
    <div className="admin-page">
      <div className="admin-hero">
        <h1 className='admin-title'>Admin Dashboard</h1>
        <p>Manage AMM configurations, whitelists, and collect fees.</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>Config</button>
        <button className={`admin-tab ${activeTab === 'operation' ? 'active' : ''}`} onClick={() => setActiveTab('operation')}>Operation Control</button>
        <button className={`admin-tab ${activeTab === 'token2022' ? 'active' : ''}`} onClick={() => setActiveTab('token2022')}>Token-2022</button>
        <button className={`admin-tab ${activeTab === 'pools' ? 'active' : ''}`} onClick={() => setActiveTab('pools')}>Pools</button>
        <button className={`admin-tab ${activeTab === 'fees' ? 'active' : ''}`} onClick={() => setActiveTab('fees')}>Fees</button>
      </div>

      {(errorState || status) && !txResult && (
        <TxSmallCard
          status={errorState ? 'error' : 'info'}
          title={errorState?.title || (errorState ? 'Error' : 'Status')}
          description={errorState?.message || status || ''}
          details={errorState?.details}
          signature={null}
          onClose={() => {
            setErrorState(null)
            setStatus(null)
          }}
        />
      )}

      {txResult && (
        <TxSmallCard
          status="success"
          title="Transaction Successful"
          description={success || 'Operation completed successfully'}
          signature={txResult.sig}
          onClose={() => {
            setTxResult(null)
            setSuccess(null)
          }}
        />
      )}

      {activeTab === 'config' && (
        <>
          <div className="admin-section">
            <h2>Create AMM Config</h2>
            <div className="admin-form">
              <div className="admin-field">
                <label>Index</label>
                <input type="number" value={configIndex} onChange={(e) => setConfigIndex(e.target.value)} />
              </div>
              <div className="admin-field">
                <label>Tick Spacing</label>
                <input type="number" value={tickSpacing} onChange={(e) => setTickSpacing(e.target.value)} />
              </div>
              <div className="admin-field">
                <label>Trade Fee Rate (10^-6)</label>
                <input type="number" value={tradeFee} onChange={(e) => setTradeFee(e.target.value)} />
              </div>
              <div className="admin-field">
                <label>Protocol Fee Rate (10^-6)</label>
                <input type="number" value={protocolFee} onChange={(e) => setProtocolFee(e.target.value)} />
              </div>
              <div className="admin-field">
                <label>Fund Fee Rate (10^-6)</label>
                <input type="number" value={fundFee} onChange={(e) => setFundFee(e.target.value)} />
              </div>
            </div>
            <div className="admin-actions">
              <button className="admin-btn admin-btn-primary" onClick={handleCreateConfig} disabled={loading}>Create Config</button>
            </div>
          </div>

          <div className="admin-section">
            <h2>Existing Configs</h2>
            <div className="admin-table-container">
              <div className="admin-grid-table">
                <div className="admin-grid-header configs-grid">
                  <span className="center">Index</span>
                  <span className="center">Tick Spacing</span>
                  <span className="center">Trade Fee</span>
                  <span className="center">Protocol Fee</span>
                  <span className="center">Fund Fee</span>
                  <span className="center">Protocol Owner</span>
                  <span className="center">Fund Owner</span>
                  <span className="center">Address</span>
                </div>
                {configs.map((c) => {
                  const configAddr = c.publicKey.toBase58()
                  const tickSpacing = c.tickSpacing?.toString?.() ?? c.tick_spacing?.toString?.() ?? '-'
                  const protocolOwner = c.owner?.toBase58?.() ?? c.protocolOwner?.toBase58?.() ?? ''
                  const fundOwner = c.fundOwner?.toBase58?.() ?? c.fund_owner?.toBase58?.() ?? ''
                  const isExpanded = expandedConfigs.has(configAddr)

                  return (
                    <React.Fragment key={configAddr}>
                      <div
                        className={`admin-grid-row configs-grid ${isExpanded ? 'expanded' : ''}`}
                      >
                        <div className="admin-grid-cell center">{c.index}</div>
                        <div className="admin-grid-cell center">{tickSpacing}</div>
                        <div className="admin-grid-cell center">{c.tradeFeeRate.toString()}</div>
                        <div className="admin-grid-cell center">{c.protocolFeeRate.toString()}</div>
                        <div className="admin-grid-cell center">{c.fundFeeRate.toString()}</div>
                        <div className="admin-grid-cell center" title={protocolOwner}>{protocolOwner ? <AdminAddress address={protocolOwner} /> : '-'}</div>
                        <div className="admin-grid-cell center" title={fundOwner}>{fundOwner ? <AdminAddress address={fundOwner} /> : '-'}</div>
                        <div className="admin-grid-cell center" title={configAddr}><AdminAddress address={configAddr} /></div>
                        <div className="admin-grid-cell center">
                          <button className="position-expand" type="button" onClick={() => {
                            const newExpanded = new Set(expandedConfigs)
                            if (newExpanded.has(configAddr)) newExpanded.delete(configAddr)
                            else newExpanded.add(configAddr)
                            setExpandedConfigs(newExpanded)
                          }}>
                            <span className={`position-expand-icon ${isExpanded ? 'open' : ''}`} />
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="admin-expanded-content">
                          <div className="pool-controls-content">
                            <p className="pool-controls-title">Update Configuration</p>
                            <div className="admin-form" style={{ marginBottom: 0 }}>
                              <div className="admin-field">
                                <label>Parameter</label>
                                <select
                                  value={updateParams[configAddr] ?? '0'}
                                  onChange={(e) => setUpdateParams(prev => ({ ...prev, [configAddr]: e.target.value }))}
                                >
                                  <option value="0">Trade Fee Rate</option>
                                  <option value="1">Protocol Fee Rate</option>
                                  <option value="2">Fund Fee Rate</option>
                                  <option value="3">New Protocol Owner (Address)</option>
                                  <option value="4">New Fund Owner (Address)</option>
                                </select>
                              </div>
                              <div className="admin-field">
                                <label>New Value</label>
                                <input
                                  type="text"
                                  value={updateValues[configAddr] ?? ''}
                                  onChange={(e) => setUpdateValues(prev => ({ ...prev, [configAddr]: e.target.value }))}
                                  placeholder={(updateParams[configAddr] ?? '0') === '3' || (updateParams[configAddr] ?? '0') === '4' ? 'PublicKey' : 'Value'}
                                />
                              </div>
                            </div>
                            <div className="pool-controls-actions">
                              <button
                                className="admin-btn admin-btn-primary"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleUpdateAmmConfig(c.publicKey)
                                }}
                                disabled={loading || !(updateValues[configAddr])}
                              >
                                Update Field
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'operation' && (
        <>
          <div className="admin-access-init-bar">
            <div className="admin-access-init-spacer" />
            <div className="admin-access-init-actions">
              <button
                className="admin-btn admin-btn-primary"
                onClick={handleCreateOperationAccount}
                disabled={loading || operationAccountExists}
              >
                {operationAccountExists ? 'Operation Account Already Created' : 'Create Operation Account'}
              </button>
              <p className="admin-section-note">*This is a one-time protocol-level operation that enables access control.</p>
            </div>
          </div>

          <div className="admin-section">
            <h2>Operation Owners</h2>
            <div className="admin-form">
              <div className="admin-field admin-field-wide">
                <label>Operation Owners</label>
                <input
                  type="text"
                  value={operationOwnerInput}
                  onChange={(e) => setOperationOwnerInput(e.target.value)}
                  placeholder="Public key(s), comma separated"
                />
              </div>
            </div>
            <div className="admin-actions admin-actions-left">
              <button
                className="admin-btn admin-btn-primary"
                onClick={() => handleUpdateOperationAccount(0, operationOwnerInput, () => setOperationOwnerInput(''), 'Operation owners added successfully')}
                disabled={loading || !isValidAddressList(operationOwnerInput)}
              >
                Add
              </button>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => handleUpdateOperationAccount(1, operationOwnerInput, () => setOperationOwnerInput(''), 'Operation owners removed successfully')}
                disabled={loading || !isValidAddressList(operationOwnerInput)}
              >
                Remove
              </button>
            </div>
            <div className="admin-list-block">
              <h3 className="admin-list-title">Current Operation Owners</h3>
              <div className="admin-list">
                {operationOwners.length === 0 ? (
                  <div className="admin-list-empty">No operation owners yet.</div>
                ) : operationOwners.map((owner: string) => (
                  <div className="admin-list-item" key={owner} title={owner} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{owner}</span>
                    <button
                      type="button"
                      className={`support-mints-copy-btn ${copiedMint === owner ? 'copied' : ''}`}
                      onClick={() => handleCopyMintAddress(owner)}
                      title={copiedMint === owner ? 'Copied' : 'Copy address'}
                      aria-label={copiedMint === owner ? 'Copied address' : 'Copy address'}
                    >
                      {copiedMint === owner ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="admin-section">
            <h2>Whitelist Mints</h2>
            <div className="admin-form">
              <div className="admin-field admin-field-wide">
                <label>Whitelist Mints</label>
                <input
                  type="text"
                  value={whitelistMintInput}
                  onChange={(e) => setWhitelistMintInput(e.target.value)}
                  placeholder="Mint address(es), comma separated"
                />
              </div>
            </div>
            <div className="admin-actions admin-actions-left">
              <button
                className="admin-btn admin-btn-primary"
                onClick={() => handleUpdateOperationAccount(2, whitelistMintInput, () => setWhitelistMintInput(''), 'Whitelist mints added successfully')}
                disabled={loading || !isValidAddressList(whitelistMintInput)}
              >
                Add
              </button>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => handleUpdateOperationAccount(3, whitelistMintInput, () => setWhitelistMintInput(''), 'Whitelist mints removed successfully')}
                disabled={loading || !isValidAddressList(whitelistMintInput)}
              >
                Remove
              </button>
            </div>
            <div className="admin-list-block">
              <h3 className="admin-list-title">Current Whitelist Mints</h3>
              <div className="admin-list">
                {whitelistMints.length === 0 ? (
                  <div className="admin-list-empty">No whitelist mints yet.</div>
                ) : whitelistMints.map((mint: string) => (
                  <div className="admin-list-item" key={mint} title={mint} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{mint}</span>
                    <button
                      type="button"
                      className={`support-mints-copy-btn ${copiedMint === mint ? 'copied' : ''}`}
                      onClick={() => handleCopyMintAddress(mint)}
                      title={copiedMint === mint ? 'Copied' : 'Copy address'}
                      aria-label={copiedMint === mint ? 'Copied address' : 'Copy address'}
                    >
                      {copiedMint === mint ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'token2022' && (
        <div className="admin-section">
          <h2>Approve Support Mint (Token-2022)</h2>
          <p className="fees-msg">Approve a Token-2022 mint to be used as a support mint in the AMM protocol.</p>
          <div className="admin-form">
            <div className="admin-field admin-field-wide">
              <label>Token-2022 Mint Address</label>
              <input type="text" value={supportMint} onChange={(e) => setSupportMint(e.target.value)} placeholder="Enter Token-2022 mint public key" />
            </div>
          </div>
          <div className="admin-actions">
            <button className="admin-btn admin-btn-primary" onClick={handleCreateSupportMintAssociated} disabled={loading || !supportMint}>Approve Mint</button>
          </div>

          <h2>Approved Support Mints</h2>
          <div className="admin-table-container support-mints-wrap">
            {supportMintAssociatedAccounts.length === 0 ? (
              <div className="admin-grid-table">
                <div className="admin-grid-row support-mints-grid empty-row">
                  <div className="admin-grid-cell center" style={{ gridColumn: '1 / -1' }}>
                    No approved support mints yet.
                  </div>
                </div>
              </div>
            ) : (
              <table className="support-mints-table">
                <thead>
                  <tr>
                    <th className="center">Mint</th>
                    <th className="center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {supportMintAssociatedAccounts.map((account) => {
                    const mint = account.mint?.toBase58?.() ?? ''
                    return (
                      <tr key={mint}>
                        <td className="support-mints-address-cell">
                          <div className="support-mints-address-row">
                            <span className="support-mints-address" title={mint}>
                              {mint || '-'}
                            </span>
                            {mint && (
                              <button
                                type="button"
                                className={`support-mints-copy-btn ${copiedMint === mint ? 'copied' : ''}`}
                                onClick={() => handleCopyMintAddress(mint)}
                                title={copiedMint === mint ? 'Copied' : 'Copy mint address'}
                                aria-label={copiedMint === mint ? 'Copied mint address' : 'Copy mint address'}
                              >
                                {copiedMint === mint ? <span className="copy-status-inline">✓</span> : <img src={copyIcon} alt="Copy" />}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="center support-mints-status-cell"><span className="admin-status-pill active">Approved</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'pools' && (
        <div className="admin-section">
          <h2>Pool Status Management</h2>
          <p className="fees-msg">Manage pool operational status. Toggle deposit, withdrawal, and swap availability.</p>
          <div className="admin-grid-table">
            <div className="admin-grid-header pools-grid">
              <span>Pool</span>
              <span className="center">Operations Status</span>
              <span className="center">Config</span>
              <span className="center"></span>
            </div>
            {pools.map((p) => {
              const poolAddr = p.publicKey.toBase58()
              const isExpanded = expandedPools.has(poolAddr)
              const pendingStatus = poolStatusChanges[poolAddr] ?? p.status

              return (
                <React.Fragment key={poolAddr}>
                  <div className={`admin-grid-row pools-grid ${isExpanded ? 'expanded' : ''}`} onClick={() => togglePoolExpansion(poolAddr, p.status)}>
                    <div className="admin-grid-cell pool-cell"><PoolDisplay poolAddr={poolAddr} token0={p.tokenMint0?.toBase58()} token1={p.tokenMint1?.toBase58()} /></div>
                    <div className="admin-grid-cell center">
                      <div className="admin-pool-status-group">
                        <span className={`status-indicator ${(p.status & 1) === 0 ? 'enabled' : 'disabled'}`}>
                          Dep
                        </span>
                        <span className={`status-indicator ${(p.status & 2) === 0 ? 'enabled' : 'disabled'}`}>
                          Wth
                        </span>
                        <span className={`status-indicator ${(p.status & 4) === 0 ? 'enabled' : 'disabled'}`}>
                          Swp
                        </span>
                      </div>
                    </div>
                    <div className="admin-grid-cell center"><AdminAddress address={p.ammConfig.toBase58()} /></div>
                    <div className="admin-grid-cell center">
                      <button
                        className="position-expand"
                        type="button"
                        aria-expanded={isExpanded}
                      >
                        <span className={`position-expand-icon ${isExpanded ? 'open' : ''}`} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="admin-expanded-content">
                      <div className="pool-controls-content">
                        <p className="pool-controls-title">Pool Controls</p>
                        <div className="pool-checkbox-group">
                          <label className="pool-checkbox-label">
                            <input
                              type="checkbox"
                              checked={(pendingStatus & 1) !== 0}
                              onChange={() => handleBitToggle(poolAddr, 1)}
                            />
                            Disable Deposits (1)
                          </label>
                          <label className="pool-checkbox-label">
                            <input
                              type="checkbox"
                              checked={(pendingStatus & 2) !== 0}
                              onChange={() => handleBitToggle(poolAddr, 2)}
                            />
                            Disable Withdrawals (2)
                          </label>
                          <label className="pool-checkbox-label">
                            <input
                              type="checkbox"
                              checked={(pendingStatus & 4) !== 0}
                              onChange={() => handleBitToggle(poolAddr, 4)}
                            />
                            Disable Swaps (4)
                          </label>
                        </div>
                        <div className="pool-status-info">
                          Current Status: <strong>{p.status}</strong>
                          {pendingStatus !== p.status && (
                            <> → New Status: <strong>{pendingStatus}</strong></>
                          )}
                        </div>
                        <div className="pool-controls-actions">
                          <button
                            className="admin-btn admin-btn-primary"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleUpdatePoolStatus(p)
                            }}
                            disabled={loading || pendingStatus === p.status}
                          >
                            Save Changes
                          </button>
                          {pendingStatus !== p.status && (
                            <button
                              className="admin-btn admin-btn-secondary"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPoolStatusChanges(prev => {
                                  const next = { ...prev }
                                  delete next[poolAddr]
                                  return next
                                })
                              }}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'fees' && (
        <div className="admin-section">
          <h2>Collect Fees</h2>
          <p className="fees-msg">This section allows collecting protocol and fund fees from specific pools.</p>
          <div className="admin-grid-table">
            <div className="admin-grid-header fees-grid">
              <span>Pool</span>
              <span className="center">Protocol Fees</span>
              <span className="center">Fund Fees</span>
              <span className="center">Actions</span>
            </div>
            {pools.map((p) => (
              <div className="admin-grid-row fees-grid" key={p.publicKey.toBase58()}>
                <div className="admin-grid-cell pool-cell"><PoolDisplay poolAddr={p.publicKey.toBase58()} token0={p.tokenMint0?.toBase58()} token1={p.tokenMint1?.toBase58()} /></div>
                <div className="admin-grid-cell center">
                  {((Number(p.protocolFeesToken0 || p.protocolFees0 || 0)) / Math.pow(10, p.mintDecimals0 || 6)).toFixed(4)} / {((Number(p.protocolFeesToken1 || p.protocolFees1 || 0)) / Math.pow(10, p.mintDecimals1 || 6)).toFixed(4)}
                </div>
                <div className="admin-grid-cell center">
                  {((Number(p.fundFeesToken0 || p.fundFees0 || 0)) / Math.pow(10, p.mintDecimals0 || 6)).toFixed(4)} / {((Number(p.fundFeesToken1 || p.fundFees1 || 0)) / Math.pow(10, p.mintDecimals1 || 6)).toFixed(4)}
                </div>
                <div className="admin-grid-cell center">
                  <div className="admin-actions" style={{ marginTop: 0, justifyContent: 'center' }}>
                    <button className="admin-btn admin-btn-secondary" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={() => {
                      navigate('/admin/collect-fees', {
                        state: {
                          pool: {
                            ...p,
                            publicKey: p.publicKey.toBase58(),
                            ammConfig: p.ammConfig.toBase58(),
                            token0Mint: p.tokenMint0?.toBase58?.(),
                            token1Mint: p.tokenMint1?.toBase58?.(),
                            token0Vault: p.tokenVault0?.toBase58?.(),
                            token1Vault: p.tokenVault1?.toBase58?.(),
                            token0Program: p.token0Program?.toBase58?.() || p.tokenProgram0?.toBase58?.() || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                            token1Program: p.token1Program?.toBase58?.() || p.tokenProgram1?.toBase58?.() || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                            protocolFees0: p.protocolFeesToken0 || p.protocolFees0,
                            protocolFees1: p.protocolFeesToken1 || p.protocolFees1,
                            fundFees0: p.fundFeesToken0 || p.fundFees0,
                            fundFees1: p.fundFeesToken1 || p.fundFees1,
                            mint0Decimals: p.mintDecimals0 || 6,
                            mint1Decimals: p.mintDecimals1 || 6,
                          },
                          type: 'protocol',
                          fromTab: 'fees'
                        }
                      })
                    }} disabled={loading}>Protocol</button>
                    <button className="admin-btn admin-btn-secondary" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={() => {
                      navigate('/admin/collect-fees', {
                        state: {
                          pool: {
                            ...p,
                            publicKey: p.publicKey.toBase58(),
                            ammConfig: p.ammConfig.toBase58(),
                            token0Mint: p.tokenMint0?.toBase58?.(),
                            token1Mint: p.tokenMint1?.toBase58?.(),
                            token0Vault: p.tokenVault0?.toBase58?.(),
                            token1Vault: p.tokenVault1?.toBase58?.(),
                            token0Program: p.token0Program?.toBase58?.() || p.tokenProgram0?.toBase58?.() || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                            token1Program: p.token1Program?.toBase58?.() || p.tokenProgram1?.toBase58?.() || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                            protocolFees0: p.protocolFeesToken0 || p.protocolFees0,
                            protocolFees1: p.protocolFeesToken1 || p.protocolFees1,
                            fundFees0: p.fundFeesToken0 || p.fundFees0,
                            fundFees1: p.fundFeesToken1 || p.fundFees1,
                            mint0Decimals: p.mintDecimals0 || 6,
                            mint1Decimals: p.mintDecimals1 || 6,
                          },
                          type: 'fund',
                          fromTab: 'fees'
                        }
                      })
                    }} disabled={loading}>Fund</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
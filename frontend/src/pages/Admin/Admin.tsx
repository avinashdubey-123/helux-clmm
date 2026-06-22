import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import useProgram from '../../utils/useProgram'
import TransactionCard from '../../components/TransactionCard/TransactionCard'
import { getAmmConfigAddress, getOperationAccountAddress, getSupportMintAssociatedAddress } from '../../utils/pda'
import copyIcon from '../../assets/copy.svg'
import './Admin.css'

const ADMIN_ID = new PublicKey('wE2EtwuovRxvXZoThsXhRTuCrFdAA1jTbLnJp9nfezL')
const DEFAULT_PUBKEY = '11111111111111111111111111111111'

// Module-level cache to persist data across page navigations without Redux bloat or serialization issues
let cachedConfigs: any[] | null = null
let cachedSupportMints: any[] | null = null
let cachedOperationAccount: any | null = null

const Admin = () => {
  const program = useProgram()
  const wallet = useWallet()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<'config' | 'operation' | 'fees' | 'pools'>(
    (location.state as any)?.activeTab || 'config'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const [operationOwnerRemoveInput, setOperationOwnerRemoveInput] = useState('')
  const [whitelistMintInput, setWhitelistMintInput] = useState('')
  const [whitelistMintRemoveInput, setWhitelistMintRemoveInput] = useState('')
  // Form states (only create AMM config is enabled)
  const [configIndex, setConfigIndex] = useState('0')
  const [tickSpacing, setTickSpacing] = useState('60')
  const [tradeFee, setTradeFee] = useState('2500')
  const [protocolFee, setProtocolFee] = useState('120000')
  const [fundFee, setFundFee] = useState('40000')

  const [expandedConfigs, setExpandedConfigs] = useState<Set<string>>(new Set())
  const [updateParams, setUpdateParams] = useState<Record<string, string>>({})
  const [updateValues, setUpdateValues] = useState<Record<string, string>>({})

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
        ? await namespace.fetchNullable(operationState)
        : await namespace.fetch(operationState)

      setOperationAccount(account)
      setOperationAccountExists(Boolean(account))
      cachedOperationAccount = account
    } catch (err) {
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
      const loadedConfigs = await configNamespace.all()
      const mappedConfigs = loadedConfigs.map((c: any) => ({ ...c.account, publicKey: c.publicKey }))
      setConfigs(mappedConfigs)
      cachedConfigs = mappedConfigs
      
      // Fetch approved support mints if namespace exists
      const supportMintNamespace = (program.account as any).supportMintAssociated
      if (supportMintNamespace && typeof supportMintNamespace.all === 'function') {
        const loadedSupportMints = await supportMintNamespace.all()
        const mappedMints = loadedSupportMints.map((e: any) => ({ ...e.account, publicKey: e.publicKey }))
        setSupportMintAssociatedAccounts(mappedMints)
        cachedSupportMints = mappedMints
      }
      await getOperationState()

    } catch (err: any) {
      console.error('Fetch error:', err)
      setError(err.message || 'Failed to fetch admin data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!cachedConfigs || !cachedSupportMints) {
      fetchData()
    }
  }, [program])

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
    } catch (err) {
      return false
    }
  }

  const handleCreateOperationAccount = async () => {
    if (!program || !wallet.publicKey) return

    setLoading(true)
    setError(null)
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

      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess('Operation account created successfully')
      await getOperationState()
    } catch (err: any) {
      setError(err.message || 'Failed to create operation account')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateOperationAccount = async (param: number, rawInput: string, clearInput: () => void, successMessage: string) => {
    if (!program || !wallet.publicKey) return

    let keys: PublicKey[] = []
    try {
      keys = parsePubkeyList(rawInput)
    } catch (err: any) {
      setError(err.message || 'Invalid public key input')
      return
    }

    if (keys.length === 0) {
      setError('Enter at least one address')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const [operationState] = getOperationAccountAddress(program.programId)
      const sig = await (program.methods as any)
        .updateOperationAccount(param, keys)
        .accounts({
          owner: wallet.publicKey,
          operationState,
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(successMessage)
      clearInput()
      await getOperationState()
    } catch (err: any) {
      setError(err.message || 'Failed to update operation account')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateConfig = async () => {
    if (!program || !wallet.publicKey) return
    setLoading(true)
    setError(null)
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

      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(`Config ${index} created successfully`)
      fetchData()
    } catch (err: any) {
      setError(err.message || 'Failed to create config')
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
    setError(null)
    setSuccess(null)
    try {
      const paramNum = parseInt(updateParam)
      let value: any;

      let remainingAccounts = []
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

      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess(`Amm Config updated successfully`)
      setUpdateValues(prev => ({ ...prev, [addrStr]: '' }))
      fetchData()
    } catch (err: any) {
      setError(err.message || 'Failed to update config')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSupportMintAssociated = async () => {
    if (!program || !wallet.publicKey) return
    if (!supportMint) {
      setError('Enter a token-2022 mint address first')
      return
    }

    setLoading(true)
    setError(null)
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

      setTxResult({ sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` })
      setSuccess('Support mint approved successfully')
      setSupportMint('')
      fetchData()
    } catch (err: any) {
      setError(err.message || 'Failed to approve support mint')
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
      setError('Failed to copy mint address')
    }
  }

  const operationOwners = ((operationAccount?.operationOwners ?? operationAccount?.operation_owners) || [])
    .filter((key: any) => key && key.toBase58 && key.toBase58() !== DEFAULT_PUBKEY)
    .map((key: any) => key.toBase58())

  const whitelistMints = ((operationAccount?.whitelistMints ?? operationAccount?.whitelist_mints) || [])
    .filter((key: any) => key && key.toBase58 && key.toBase58() !== DEFAULT_PUBKEY)
    .map((key: any) => key.toBase58())

  // Whitelist / pool actions are disabled in this build

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
        <button className={`admin-tab ${activeTab === 'pools' ? 'active' : ''}`} onClick={() => setActiveTab('pools')}>Pools</button>
        <button className={`admin-tab ${activeTab === 'fees' ? 'active' : ''}`} onClick={() => setActiveTab('fees')}>Fees</button>
      </div>

      {(error || status) && !txResult && (
        <TransactionCard
          status={error ? 'error' : 'info'}
          title={error ? 'Error' : 'Status'}
          message={error || status || ''}
          onClose={() => {
            setError(null)
            setStatus(null)
          }}
        />
      )}

      {txResult && (
        <TransactionCard
          status="success"
          title="Transaction Successful"
          message={success || 'Operation completed successfully'}
          explorerUrl={txResult.explorer}
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
                        <div className="admin-grid-cell center" title={protocolOwner}>{protocolOwner ? `${protocolOwner.slice(0, 8)}...` : '-'}</div>
                        <div className="admin-grid-cell center" title={fundOwner}>{fundOwner ? `${fundOwner.slice(0, 8)}...` : '-'}</div>
                        <div className="admin-grid-cell center" title={configAddr}>{configAddr.slice(0, 8)}...</div>
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

          <div className="admin-section">
            <h2>Approve Support Mint</h2>
            <div className="admin-form">
              <div className="admin-field admin-field-wide">
                <label>Token-2022 Mint</label>
                <input type="text" value={supportMint} onChange={(e) => setSupportMint(e.target.value)} placeholder="Mint public key" />
              </div>
            </div>
            <div className="admin-actions">
              <button className="admin-btn admin-btn-primary" onClick={handleCreateSupportMintAssociated} disabled={loading || !supportMint}>Approve Mint</button>
            </div>
          </div>

          <div className="admin-section">
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
                                  <img src={copyIcon} alt="Copy" />
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
                <label>Add Operation Owners</label>
                <input
                  type="text"
                  value={operationOwnerInput}
                  onChange={(e) => setOperationOwnerInput(e.target.value)}
                  placeholder="Public key(s), comma separated"
                />
              </div>
              <div className="admin-field admin-field-wide">
                <label>Remove Operation Owners</label>
                <input
                  type="text"
                  value={operationOwnerRemoveInput}
                  onChange={(e) => setOperationOwnerRemoveInput(e.target.value)}
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
                onClick={() => handleUpdateOperationAccount(1, operationOwnerRemoveInput, () => setOperationOwnerRemoveInput(''), 'Operation owners removed successfully')}
                disabled={loading || !isValidAddressList(operationOwnerRemoveInput)}
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
                  <div className="admin-list-item" key={owner} title={owner}>{owner}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="admin-section">
            <h2>Whitelist Mints</h2>
            <div className="admin-form">
              <div className="admin-field admin-field-wide">
                <label>Add Whitelist Mints</label>
                <input
                  type="text"
                  value={whitelistMintInput}
                  onChange={(e) => setWhitelistMintInput(e.target.value)}
                  placeholder="Mint address(es), comma separated"
                />
              </div>
              <div className="admin-field admin-field-wide">
                <label>Remove Whitelist Mints</label>
                <input
                  type="text"
                  value={whitelistMintRemoveInput}
                  onChange={(e) => setWhitelistMintRemoveInput(e.target.value)}
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
                onClick={() => handleUpdateOperationAccount(3, whitelistMintRemoveInput, () => setWhitelistMintRemoveInput(''), 'Whitelist mints removed successfully')}
                disabled={loading || !isValidAddressList(whitelistMintRemoveInput)}
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
                  <div className="admin-list-item" key={mint} title={mint}>{mint}</div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'pools' && (
        <div className="admin-section">
          <h2>Pools (disabled)</h2>
          <p>Pool management is disabled in this build.</p>
        </div>
      )}


      {activeTab === 'fees' && (
        <div className="admin-section">
          <h2>Fees (disabled)</h2>
          <p>Fee collection is disabled in this build.</p>
        </div>
      )}
    </div>
  )
}

export default Admin

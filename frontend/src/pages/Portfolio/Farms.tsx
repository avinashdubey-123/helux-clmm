import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { usePools, PoolRowData } from '../../contexts/PoolsContext';
import { useTransactions } from '../../contexts/TxContext';
import useProgram from '../../utils/useProgram';
import { getOperationAccountAddress, getPoolRewardVaultAddress } from '../../utils/pda';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import { useNavigate } from 'react-router-dom';
import TxSmallCard from '../../components/TxSmallCard/TxSmallCard';
import FarmPeriodPicker from '../../components/FarmPeriodPicker/FarmPeriodPicker';
import copyIcon from '../../assets/copy.svg';
import Loader from '../../components/Loader/Loader';
import './Portfolio.css';

// A single reward row component
function FarmRow({ pool, rewardInfo, rewardIndex }: { pool: PoolRowData, rewardInfo: any, rewardIndex: number }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const program = useProgram();
  const { addTransaction } = useTransactions();
  
  const [busy, setBusy] = useState(false);
  const [txState, setTxState] = useState<{status: 'error' | 'success', title: string, message: string, details?: string, signature?: string} | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [copiedPool, setCopiedPool] = useState(false);
  const [copiedMint, setCopiedMint] = useState(false);

  const handleCopyPool = () => {
    navigator.clipboard.writeText(pool.poolPda);
    setCopiedPool(true);
    setTimeout(() => setCopiedPool(false), 2000);
  };

  const handleCopyMint = () => {
    navigator.clipboard.writeText(rewardInfo.tokenMint);
    setCopiedMint(true);
    setTimeout(() => setCopiedMint(false), 2000);
  };

  const formatLocal = (unixTime: number) => {
    const d = new Date(unixTime * 1000);
    if (isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  
  let initialRewardsPerWeek = '';
  if (rewardInfo.emissionsPerSecondX64 && rewardInfo.emissionsPerSecondX64 !== '0') {
    const Q64 = new BN(1).ushln(64);
    const val = new BN(rewardInfo.emissionsPerSecondX64).div(Q64).toNumber();
    // Tokens per second -> Tokens per week
    const decimalsDivisor = Math.pow(10, rewardInfo.tokenDecimals ?? 6);
    initialRewardsPerWeek = (val * 86400 * 7 / decimalsDivisor).toFixed(2);
  }

  const [formData, setFormData] = useState({
    openTime: rewardInfo.openTime ? formatLocal(rewardInfo.openTime) : '',
    endTime: rewardInfo.endTime ? formatLocal(rewardInfo.endTime) : '',
    rewardsPerWeek: initialRewardsPerWeek,
    extendDays: ''
  });

  const now = Date.now() / 1000;
  const isEnded = rewardInfo.endTime ? now >= rewardInfo.endTime : false;
  const isStarted = rewardInfo.openTime ? now > rewardInfo.openTime : false;
  const isActive = isStarted && !isEnded;
  
  const formatDateRange = (start: number, end: number) => {
    if (!start || !end) return 'Unknown';
    const d1 = new Date(start * 1000);
    const d2 = new Date(end * 1000);
    const s = `${String(d1.getDate()).padStart(2, '0')}/${String(d1.getMonth() + 1).padStart(2, '0')}/${d1.getFullYear()}`;
    const e = `${String(d2.getDate()).padStart(2, '0')}/${String(d2.getMonth() + 1).padStart(2, '0')}/${d2.getFullYear()}`;
    const days = (end - start) / 86400;
    return `${s} - ${e} (${days.toFixed(1)} Days)`;
  };

  const calculateDurationDays = () => {
    if (!formData.openTime || !formData.endTime) return 0;
    const start = new Date(formData.openTime).getTime();
    const end = new Date(formData.endTime).getTime();
    if (end <= start) return 0;
    return (end - start) / (1000 * 60 * 60 * 24);
  };

  const calculateTotalTokens = () => {
    if (!formData.endTime || !formData.rewardsPerWeek || !rewardInfo.endTime) return 0;
    
    const currentNow = Math.floor(Date.now() / 1000);
    const newEndTime = Math.floor(new Date(formData.endTime).getTime() / 1000);
    const oldEndTime = rewardInfo.endTime;
    
    const tokensPerDay = parseFloat(formData.rewardsPerWeek) / 7;
    const newTokensPerSecond = tokensPerDay / 86400;
    
    let oldTokensPerSecond = 0;
    if (rewardInfo.emissionsPerSecondX64 && rewardInfo.emissionsPerSecondX64 !== '0') {
      const Q64 = new BN(1).ushln(64);
      const decimalsDivisor = Math.pow(10, rewardInfo.tokenDecimals ?? 6);
      oldTokensPerSecond = new BN(rewardInfo.emissionsPerSecondX64).div(Q64).toNumber() / decimalsDivisor;
    }
    
    let requiredTokens = 0;
    
    if (isActive) {
      const leftRewardTime = Math.max(0, oldEndTime - currentNow);
      const extendPeriod = Math.max(0, newEndTime - oldEndTime);
      
      if (newTokensPerSecond > oldTokensPerSecond) {
        requiredTokens += leftRewardTime * (newTokensPerSecond - oldTokensPerSecond);
      }
      if (extendPeriod > 0) {
        requiredTokens += extendPeriod * newTokensPerSecond;
      }
    } else if (isEnded) {
      const newOpenTime = Math.floor(new Date(formData.openTime).getTime() / 1000);
      const timeDelta = Math.max(0, newEndTime - newOpenTime);
      requiredTokens = timeDelta * newTokensPerSecond;
    }
    
    return requiredTokens;
  };
  
  const remainingSeconds = Math.max(0, (rewardInfo.endTime || 0) - Math.max(now, rewardInfo.openTime || 0));
  let unemitted = 0;
  if (rewardInfo.emissionsPerSecondX64 && rewardInfo.emissionsPerSecondX64 !== '0') {
    const Q64 = new BN(1).ushln(64);
    const emissionsPerSec = new BN(rewardInfo.emissionsPerSecondX64).div(Q64).toNumber();
    const decimalsDivisor = Math.pow(10, rewardInfo.tokenDecimals ?? 6);
    unemitted = remainingSeconds * emissionsPerSec / decimalsDivisor;
  }

  const getRewardParams = (decimals: number = 6) => {
    if (!formData.openTime || !formData.endTime || !formData.rewardsPerWeek) {
      throw new Error("Invalid value for one or more of the fields.");
    }
    const currentNow = Math.floor(Date.now() / 1000);
    let openTime = Math.floor(new Date(formData.openTime).getTime() / 1000);
    let endTime = Math.floor(new Date(formData.endTime).getTime() / 1000);
    
    if (isNaN(openTime) || isNaN(endTime)) {
      throw new Error("Invalid value for one or more of the fields.");
    }
    
    if (!isStarted) {
      throw new Error("Cannot edit farm parameters before the farm has started.");
    }

    const tokensPerDay = parseFloat(formData.rewardsPerWeek) / 7;
    if (isNaN(tokensPerDay)) {
      throw new Error("Invalid value for one or more of the fields.");
    }
    const tokensPerSecond = tokensPerDay / 86400;
    const rawTokensPerSecond = tokensPerSecond * Math.pow(10, decimals);
    const integerPart = Math.floor(rawTokensPerSecond);
    const Q64 = new BN(1).ushln(64);
    const emissionsPerSecondX64 = new BN(integerPart).mul(Q64);
    
    const MIN_REWARD_PERIOD = 7 * 86400;
    const MAX_REWARD_PERIOD = 90 * 86400;
    const INCREASE_EMISSIONES_PERIOD = 3 * 86400; // 72 hours
    
    if (isActive) {
      const extendPeriod = endTime - Number(rewardInfo.endTime);
      
      if (!formData.extendDays) {
        throw new Error("Invalid value for one or more of the fields.");
      }
      
      if (extendPeriod < MIN_REWARD_PERIOD || extendPeriod > MAX_REWARD_PERIOD) {
        throw new Error("Active farms must be extended by between 7 and 90 days.");
      }
      
      const currentEmissions = new BN(rewardInfo.emissionsPerSecondX64);
      if (emissionsPerSecondX64.lt(currentEmissions)) {
        const leftRewardTime = Number(rewardInfo.endTime) - currentNow;
        if (leftRewardTime > INCREASE_EMISSIONES_PERIOD) {
          throw new Error("Cannot decrease reward rate unless the farm is within 72 hours of ending.");
        }
      }
    } else if (isEnded) {
      const timeDelta = endTime - openTime;
      if (timeDelta < MIN_REWARD_PERIOD || timeDelta > MAX_REWARD_PERIOD) {
        throw new Error("Farm period must be between 7 and 90 days.");
      }
    }
    
    if (openTime <= currentNow + 10) openTime = currentNow + 60;
    if (endTime <= openTime) throw new Error("End time must be after open time.");

    return {
      openTime: new BN(openTime),
      endTime: new BN(endTime),
      emissionsPerSecondX64
    };
  };

  let validationError: string | null = null;
  if (isEditing) {
    try {
      getRewardParams();
    } catch (e: any) {
      validationError = e.message;
    }
  }

  const handleUpdateRewardParams = async () => {
    if (!program || !publicKey || !signTransaction) return;
    setBusy(true); setTxState(null);
    try {
      const rewardMintKey = new PublicKey(rewardInfo.tokenMint);
      let mintDecimals = 6;
      let tokenProgramId = TOKEN_PROGRAM_ID;
      try {
        const mintInfo = await connection.getParsedAccountInfo(rewardMintKey);
        if (mintInfo.value?.owner) tokenProgramId = mintInfo.value.owner;
        // @ts-ignore
        if (mintInfo.value?.data?.parsed?.info?.decimals !== undefined) mintDecimals = mintInfo.value.data.parsed.info.decimals;
      } catch (e) {}

      const params = getRewardParams(mintDecimals);
      const poolPda = new PublicKey(pool.poolPda);
      const ammConfig = new PublicKey(pool.ammConfig);
      const operationState = getOperationAccountAddress(program.programId)[0];

      const rewardVault = getPoolRewardVaultAddress(poolPda, rewardMintKey, program.programId)[0];
      const userRewardAccount = getAssociatedTokenAddressSync(rewardMintKey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
      
      const instruction = await program.methods.setRewardParams(
        rewardIndex, params.emissionsPerSecondX64, params.openTime, params.endTime
      ).accounts({
        authority: publicKey, ammConfig, poolState: poolPda, operationState, tokenProgram: TOKEN_PROGRAM_ID, tokenProgram2022: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
      })
      .remainingAccounts([
        { pubkey: rewardVault, isWritable: true, isSigner: false },
        { pubkey: userRewardAccount, isWritable: true, isSigner: false },
        { pubkey: rewardMintKey, isWritable: false, isSigner: false }
      ])
      .instruction();

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(instruction);
      tx.feePayer = publicKey; tx.recentBlockhash = blockhash;
      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      addTransaction(signature, `Updated Farm Reward parameters`, 'Success', true);
      setTxState({ status: 'success', title: 'Success', message: 'Reward parameters updated successfully!', signature });
      setIsEditing(false);
    } catch (err: any) {
      setTxState({ status: 'error', title: 'Failed to update', message: 'Transaction failed.', details: err.message || err.toString() });
    } finally { setBusy(false); }
  };

  const handleReclaimFunds = async () => {
    if (!program || !publicKey || !signTransaction) return;
    setBusy(true); setTxState(null);
    try {
      const rewardMintKey = new PublicKey(rewardInfo.tokenMint);
      let tokenProgramId = TOKEN_PROGRAM_ID;
      try {
        const mintInfo = await connection.getParsedAccountInfo(rewardMintKey);
        if (mintInfo.value?.owner) tokenProgramId = mintInfo.value.owner;
      } catch (e) {}

      const poolPda = new PublicKey(pool.poolPda);
      const funderTokenAccount = getAssociatedTokenAddressSync(rewardMintKey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
      const rewardTokenVault = getPoolRewardVaultAddress(poolPda, rewardMintKey, program.programId)[0];

      const instruction = await program.methods.collectRemainingRewards(rewardIndex).accounts({
        rewardFunder: publicKey, funderTokenAccount, poolState: poolPda, rewardTokenVault, rewardVaultMint: rewardMintKey,
        tokenProgram: TOKEN_PROGRAM_ID, tokenProgram2022: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'), memoProgram: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
      }).instruction();

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(instruction);
      tx.feePayer = publicKey; tx.recentBlockhash = blockhash;
      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      addTransaction(signature, `Reclaimed remaining funds`, 'Success', true);
      setTxState({ status: 'success', title: 'Success', message: 'Remaining funds reclaimed successfully!', signature });
    } catch (err: any) {
      setTxState({ status: 'error', title: 'Failed to reclaim', message: 'Transaction failed.', details: err.message || err.toString() });
    } finally { setBusy(false); }
  };

  const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase();
  const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase();
  const tokenAbbr = rewardInfo.tokenMint.slice(0, 4).toUpperCase();

  return (
    <div className="portfolio-pool-card reward-stat-box farm-row-card" style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: '12px', right: '16px', fontSize: '11px', color: '#7a8fa6', display: 'flex', alignItems: 'center', gap: '6px' }}>
        Farm Address: <span style={{ color: '#39d0d8' }}>{pool.poolPda.slice(0, 4)}...{pool.poolPda.slice(-4)}</span>
        <button onClick={handleCopyPool} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }} title="Copy Farm Address">
          {copiedPool ? <span style={{ color: '#39d0d8', fontSize: '12px' }}>✓</span> : <img src={copyIcon} alt="copy" style={{ width: '12px', height: '12px', opacity: 0.7 }} />}
        </button>
      </div>
      <div className="reward-stat-header farm-row-header" style={{ marginTop: '12px' }}>
        <div className="farm-row-col">
          <span className="farm-row-label">Pool</span>
          <strong className="farm-row-value farm-row-title-flex" style={{ display: 'flex', alignItems: 'center' }}>
            {t0Name} - {t1Name}
            <button onClick={handleCopyPool} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', marginLeft: '6px' }} title="Copy Pool Address">
              {copiedPool ? <span style={{ color: '#39d0d8', fontSize: '12px' }}>✓</span> : <img src={copyIcon} alt="copy" style={{ width: '12px', height: '12px', opacity: 0.7 }} />}
            </button>
          </strong>
        </div>
        <div className="farm-row-col">
          <span className="farm-row-label">Reward Token</span>
          <strong className="farm-row-value farm-row-title-flex">
            {tokenAbbr}
            <button onClick={handleCopyMint} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', marginLeft: '4px' }} title="Copy Token Mint">
              {copiedMint ? <span style={{ color: '#39d0d8', fontSize: '12px' }}>✓</span> : <img src={copyIcon} alt="copy" style={{ width: '12px', height: '12px', opacity: 0.7 }} />}
            </button>
          </strong>
        </div>
        <div className="farm-row-col">
          <span className="farm-row-label">Period</span>
          <strong className="farm-row-value" style={{ whiteSpace: 'nowrap' }}>
            {formatDateRange(rewardInfo.openTime, rewardInfo.endTime)}
          </strong>
        </div>
        <div className="farm-row-col">
          <span className="farm-row-label">Unemitted Rewards</span>
          <strong className="farm-row-value">
            {unemitted > 0 ? unemitted.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}
          </strong>
        </div>
        <div className="farm-row-col">
          <span className="farm-row-label">Status</span>
          <span className={`position-status-badge ${isEnded ? 'out-range' : 'in-range'} farm-row-status-badge`}>
            <span className="status-dot"></span>
            {isEnded ? 'Ended' : 'Active'}
          </span>
        </div>
        <div className="farm-row-actions">
          <button 
            className="pos-btn collect-rewards-btn farm-row-btn" 
            style={{ filter: (busy || !isEnded) ? 'brightness(0.8)' : 'none', opacity: (busy || !isEnded) ? 0.7 : 1 }}
            onClick={handleReclaimFunds}
            disabled={busy || !isEnded}
            title={!isEnded ? "Campaign must end before reclaiming funds." : ""}
          >
            {busy ? '...' : 'Collect Remaining Rewards'}
          </button>
          <button 
            className="pos-btn pos-btn-deposit farm-row-btn" 
            onClick={() => setIsEditing(!isEditing)}
            disabled={busy || !isStarted}
            title={!isStarted ? "Cannot edit farm before it has opened." : ""}
          >
            {isEditing ? 'Cancel Edit' : 'Edit Farm'}
          </button>
        </div>
      </div>
      
      {isEditing && typeof document !== 'undefined' && createPortal(
        <div className="portfolio-modal-overlay">
          <div className="portfolio-modal-backdrop" onClick={() => setIsEditing(false)} />
          <div className="portfolio-modal-content" style={{ maxWidth: '600px' }}>
            <button className="portfolio-modal-close" onClick={() => setIsEditing(false)}>✕</button>
            <div className="portfolio-modal-header">
              <h2>Edit Farm: {t0Name} - {t1Name}</h2>
              <p className="portfolio-subtitle">Update parameters for your {tokenAbbr} reward farm.</p>
            </div>
            <div className="portfolio-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {isActive && (
                <div style={{ fontSize: '13px', color: '#ffb020', background: 'rgba(255, 176, 32, 0.1)', padding: '12px', borderRadius: '8px' }}>
                  <strong>Note:</strong> You must extend the End Time by at least 7 days from its current end time. You cannot decrease the reward rate unless the farm is within 72 hours of ending.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', textAlign: 'left' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                  <label style={{ fontSize: '14px', color: '#7a8fa6', fontWeight: 600, textAlign: 'left' }}>
                    {isActive ? 'Extend Duration (Days)' : 'Farm Period'}
                  </label>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      {isActive ? (
                        <input 
                          type="number" 
                          min="7"
                          className="portfolio-search-bar" 
                          style={{ width: '100%', marginBottom: 0, padding: '12px', background: '#0d1321', border: '1px solid #1e2d45', borderRadius: '8px', color: '#e6f0ff', boxSizing: 'border-box' }}
                          placeholder="e.g. 7"
                          value={formData.extendDays} 
                          onChange={e => {
                            const days = parseInt(e.target.value) || 0;
                            const newEndUnix = rewardInfo.endTime + (days * 86400);
                            setFormData(p => ({ ...p, extendDays: e.target.value, endTime: formatLocal(newEndUnix) }));
                          }} 
                        />
                      ) : (
                        <FarmPeriodPicker 
                          className="portfolio-search-bar dt-override-style"
                          startTime={formData.openTime} 
                          endTime={formData.endTime} 
                          lockStartDate={isActive}
                          onChange={(start, end) => setFormData(p => ({ ...p, openTime: start, endTime: end }))} 
                        />
                      )}
                    </div>
                    <div style={{ color: '#e6f0ff', fontSize: '14px', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px' }}>
                      {isActive ? (
                        formData.extendDays && parseInt(formData.extendDays) > 0 ? `Ends: ${(() => {
                          const d = new Date(formData.endTime);
                          if (isNaN(d.getTime())) return '-';
                          return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                        })()}` : '- Days'
                      ) : (
                        (() => {
                          if (!formData.openTime || !formData.endTime) return '- Days';
                          const start = new Date(formData.openTime).getTime();
                          const end = new Date(formData.endTime).getTime();
                          if (end <= start) return '- Days';
                          const days = (end - start) / (1000 * 60 * 60 * 24);
                          return `${days.toFixed(1)} Days`;
                        })()
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '14px', color: '#7a8fa6', fontWeight: 600, textAlign: 'left' }}>Rewards Per Week</label>
                  <button 
                    style={{ background: 'none', border: 'none', color: '#39d0d8', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                    onClick={() => setFormData(p => ({ ...p, rewardsPerWeek: initialRewardsPerWeek }))}
                  >
                    Reset
                  </button>
                </div>
                <input 
                  type="number" 
                  className="portfolio-search-bar" 
                  style={{ width: '100%', marginBottom: 0, padding: '12px', background: '#0d1321', border: '1px solid #1e2d45', borderRadius: '8px', color: '#e6f0ff' }}
                  placeholder="e.g. 1000"
                  value={formData.rewardsPerWeek} 
                  onChange={e => setFormData(p => ({ ...p, rewardsPerWeek: e.target.value }))} 
                />
              </div>

              {!validationError && calculateTotalTokens() > 0 && (
                <div style={{ fontSize: '14px', color: '#39d0d8', background: 'rgba(57, 208, 216, 0.05)', padding: '12px', borderRadius: '8px' }}>
                  <strong>{isActive ? 'Extra Required (Delta):' : 'Total Required:'}</strong> {calculateTotalTokens().toFixed(4)} tokens 
                  {isEnded && ` (over ${calculateDurationDays().toFixed(1)} days)`}
                </div>
              )}
              
              {validationError && (
                <div style={{ fontSize: '13px', color: '#ff4d4f', padding: '8px 12px', background: 'rgba(255, 77, 79, 0.1)', borderRadius: '8px', border: '1px solid rgba(255, 77, 79, 0.3)' }}>
                  ⚠️ {validationError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', gap: '12px' }}>
                <button className="pos-btn pos-btn-withdraw" onClick={() => setIsEditing(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="pos-btn pos-btn-harvest" onClick={handleUpdateRewardParams} disabled={busy || !!validationError}>
                  {busy ? 'Processing...' : 'Save Parameters'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {txState && (
        <div style={{ marginTop: '16px' }}>
          <TxSmallCard
            status={txState.status}
            title={txState.title}
            description={txState.message}
            details={txState.details}
            signature={txState.signature || null}
            onClose={() => setTxState(null)}
          />
        </div>
      )}
    </div>
  );
}

export default function Farms() {
  const { publicKey } = useWallet();
  const { pools, loadingPools } = usePools();
  const navigate = useNavigate();

  if (loadingPools) {
    return (
      <div className="portfolio-loader-container">
        <Loader size={36} />
      </div>
    );
  }

  if (!publicKey) {
    return (
      <div className="portfolio-empty-container">
        <p>Please connect your wallet to view and manage your portfolio.</p>
      </div>
    );
  }

  // Flatten and sort the farms
  const activeFarms: { pool: PoolRowData, rewardInfo: any, rewardIndex: number }[] = [];
  pools.forEach(pool => {
    if (pool.poolCreator === publicKey.toBase58() && pool.rewardInfos) {
      pool.rewardInfos.forEach((ri, idx) => {
        if (ri.initialized && ri.tokenMint !== "11111111111111111111111111111111") {
          activeFarms.push({ pool, rewardInfo: ri, rewardIndex: idx });
        }
      });
    }
  });

  // Sort alphabetically by pool name (t0 - t1)
  activeFarms.sort((a, b) => {
    const nameA = a.pool.tokenMint0.slice(0, 4) + a.pool.tokenMint1.slice(0, 4);
    const nameB = b.pool.tokenMint0.slice(0, 4) + b.pool.tokenMint1.slice(0, 4);
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="portfolio-farms-tab">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: '#e6f0ff', fontSize: '20px' }}>My Managed Farms</h2>
        <button className="pos-btn create-farm-btn" onClick={() => navigate('/liquidity/create-farm')}>
          Create Farm
        </button>
      </div>

      {activeFarms.length === 0 ? (
        <div className="portfolio-empty-container">
          <p>You have not created any farms yet.</p>
        </div>
      ) : (
        <div className="portfolio-pools-list">
          {activeFarms.map((farm, idx) => (
            <FarmRow key={`${farm.pool.poolPda}-${farm.rewardIndex}-${idx}`} {...farm} />
          ))}
        </div>
      )}
    </div>
  );
}

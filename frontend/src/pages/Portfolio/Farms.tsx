import { useEffect, useState } from 'react';
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
  const { refreshPools } = usePools();

  const [busy, setBusy] = useState(false);
  const [txState, setTxState] = useState<{ status: 'error' | 'success', title: string, message: string, details?: string, signature?: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [copiedPool, setCopiedPool] = useState(false);
  const [copiedMint, setCopiedMint] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!program || !publicKey) return;
    const checkAdmin = async () => {
      try {
        const [operationStateAddress] = getOperationAccountAddress(program.programId);
        const namespace = (program.account as any).operationState;
        if (!namespace) return;
        const account = await namespace.fetch(operationStateAddress);
        const adminKeys = account.operationOwners.map((k: any) => k.toString());
        const devnetAdmin = "wE2EtwuovRxvXZoThsXhRTuCrFdAA1jTbLnJp9nfezL";
        if (adminKeys.includes(publicKey.toString()) || publicKey.toString() === devnetAdmin ) {
          setIsAdmin(true);
        }
      } catch (e) {
        console.error("Failed to check admin status", e);
      }
    };
    checkAdmin();
  }, [program, publicKey]);

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
    // Use BigInt to decode X64 fixed-point without integer truncation:
    // emissionsPerSecondX64 = raw_tokens_per_sec * 2^64
    // Scale up by 10^9 before dividing to preserve fractional raw-token rates.
    const DEC_SCALE = BigInt(1_000_000_000);
    const emX64 = BigInt(rewardInfo.emissionsPerSecondX64);
    const Q64b = BigInt(1) << BigInt(64);
    const rawPerSec = Number((emX64 * DEC_SCALE) / Q64b) / 1_000_000_000;
    const decimalsDivisor = Math.pow(10, rewardInfo.tokenDecimals ?? 6);
    initialRewardsPerWeek = (rawPerSec / decimalsDivisor * 86400 * 7).toFixed(6).replace(/\.?0+$/, '');
  }

  const openTimeNum = rewardInfo.openTime ? Number(rewardInfo.openTime.toString()) : 0;
  const endTimeNum = rewardInfo.endTime ? Number(rewardInfo.endTime.toString()) : 0;

  const [formData, setFormData] = useState({
    openTime: openTimeNum > 0 ? formatLocal(openTimeNum) : formatLocal(Date.now() / 1000),
    endTime: endTimeNum > 0 ? formatLocal(endTimeNum) : formatLocal((Date.now() / 1000) + 86400 * 7),
    rewardsPerWeek: initialRewardsPerWeek,
    extendDays: ''
  });

  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(interval);
  }, []);

  const isEnded = endTimeNum > 0 ? now >= endTimeNum : false;
  const isStarted = openTimeNum > 0 ? now > openTimeNum : false;
  const isActive = isStarted && !isEnded;
  const isUpcoming = !isStarted && !isEnded;

  const getFormattedDates = (start: number, end: number) => {
    if (!start || !end) return { short: 'Unknown', detailed: 'Unknown' };
    const d1 = new Date(start * 1000);
    const d2 = new Date(end * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    
    const sShort = `${pad(d1.getDate())}/${pad(d1.getMonth() + 1)}/${d1.getFullYear()}`;
    const eShort = `${pad(d2.getDate())}/${pad(d2.getMonth() + 1)}/${d2.getFullYear()}`;
    
    const sDetailed = `${sShort} ${pad(d1.getHours())}:${pad(d1.getMinutes())}`;
    const eDetailed = `${eShort} ${pad(d2.getHours())}:${pad(d2.getMinutes())}`;
    
    const days = (end - start) / 86400;
    return {
      short: `${sShort} - ${eShort} (${days.toFixed(1)} Days)`,
      detailed: `${sDetailed} - ${eDetailed} (${days.toFixed(1)} Days)`
    };
  };

  const periodDates = getFormattedDates(openTimeNum, endTimeNum);

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
    const oldEndTime = endTimeNum;
    let newEndTime = Math.floor(new Date(formData.endTime).getTime() / 1000);

    if (isActive && formData.extendDays) {
      const days = parseInt(formData.extendDays) || 0;
      newEndTime = oldEndTime + (days * 86400);
    }

    const tokensPerDay = parseFloat(formData.rewardsPerWeek) / 7;
    const newTokensPerSecond = tokensPerDay / 86400;

    let oldTokensPerSecond = 0;
    if (rewardInfo.emissionsPerSecondX64 && rewardInfo.emissionsPerSecondX64 !== '0') {
      const DEC_SCALE = BigInt(1_000_000_000);
      const emX64 = BigInt(rewardInfo.emissionsPerSecondX64);
      const Q64b = BigInt(1) << BigInt(64);
      const rawPerSec = Number((emX64 * DEC_SCALE) / Q64b) / 1_000_000_000;
      const decimalsDivisor = Math.pow(10, rewardInfo.tokenDecimals ?? 6);
      oldTokensPerSecond = rawPerSec / decimalsDivisor;
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

  const remainingSeconds = Math.max(0, endTimeNum - Math.max(now, openTimeNum));
  let unemitted = 0;
  if (rewardInfo.emissionsPerSecondX64 && rewardInfo.emissionsPerSecondX64 !== '0') {
    const DEC_SCALE = BigInt(1_000_000_000);
    const emX64 = BigInt(rewardInfo.emissionsPerSecondX64);
    const Q64b = BigInt(1) << BigInt(64);
    const rawPerSec = Number((emX64 * DEC_SCALE) / Q64b) / 1_000_000_000;
    const decimalsDivisor = Math.pow(10, rewardInfo.tokenDecimals ?? 6);
    unemitted = remainingSeconds * rawPerSec / decimalsDivisor;
  }

  const getRewardParams = (decimals: number = 6) => {
    if (!formData.openTime || !formData.endTime || !formData.rewardsPerWeek) {
      throw new Error("Invalid value for one or more of the fields.");
    }
    const currentNow = Math.floor(Date.now() / 1000);
    let openTime = Math.floor(new Date(formData.openTime).getTime() / 1000);
    let endTime = Math.floor(new Date(formData.endTime).getTime() / 1000);

    if (isActive && formData.extendDays) {
      const days = parseInt(formData.extendDays) || 0;
      endTime = Number(rewardInfo.endTime) + (days * 86400);
    }

    if (isNaN(openTime) || isNaN(endTime)) {
      throw new Error("Invalid value for one or more of the fields.");
    }

    if (!isStarted && !isAdmin) {
      throw new Error("Cannot edit farm parameters before the farm has started.");
    }

    const tokensPerDay = parseFloat(formData.rewardsPerWeek) / 7;
    if (isNaN(tokensPerDay)) {
      throw new Error("Invalid value for one or more of the fields.");
    }
    const tokensPerSecond = tokensPerDay / 86400;
    const rawTokensPerSecond = tokensPerSecond * Math.pow(10, decimals);
    // Encode as X64 fixed-point using BigInt to preserve sub-integer rates.
    // Scale by 10^9 to keep 9 decimal digits of precision before multiplying by 2^64.
    const ENC_SCALE = BigInt(1_000_000_000);
    const scaledRaw = BigInt(Math.round(rawTokensPerSecond * 1_000_000_000));
    const Q64b = BigInt(1) << BigInt(64);
    const emissionsPerSecondX64 = new BN(((scaledRaw * Q64b) / ENC_SCALE).toString());

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
        if (leftRewardTime > INCREASE_EMISSIONES_PERIOD && !isAdmin) {
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
    if (endTime <= openTime) throw new Error("Please select a valid date and time range.");

    return {
      openTime: new BN(openTime),
      endTime: new BN(endTime),
      emissionsPerSecondX64
    };
  };

  let validationError: string | null = null;
  if (isEditing) {
    try {
      getRewardParams(rewardInfo.tokenDecimals ?? 6);
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
      } catch (e) { }

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
      refreshPools();
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
      } catch (e) { }

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
      refreshPools();
    } catch (err: any) {
      setTxState({ status: 'error', title: 'Failed to reclaim', message: 'Transaction failed.', details: err.message || err.toString() });
    } finally { setBusy(false); }
  };

  const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase();
  const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase();
  const tokenAbbr = rewardInfo.tokenMint.slice(0, 4).toUpperCase();

  return (
    <div className="portfolio-pool-card reward-stat-box farm-row-card">
      <div className="farm-address">
        Farm Address: <span className="farm-address-value">{pool.poolPda.slice(0, 4)}...{pool.poolPda.slice(-4)}</span>
        <button className="farm-copy-btn" onClick={handleCopyPool} title="Copy Farm Address">
          {copiedPool ? <span className="farm-copy-status">✓</span> : <img src={copyIcon} alt="copy" />}
        </button>
      </div>
      <div className="reward-stat-header farm-row-header">
        <div className="farm-row-col">
          <span className="farm-row-label">Pool</span>
          <strong className="farm-row-value farm-row-title-flex">
            {t0Name} - {t1Name}
            <button className="farm-copy-btn" onClick={handleCopyPool} title="Copy Pool Address">
              {copiedPool ? <span className="farm-copy-status">✓</span> : <img src={copyIcon} alt="copy" />}
            </button>
          </strong>
        </div>
        <div className="farm-row-col">
          <span className="farm-row-label">Reward Token</span>
          <strong className="farm-row-value farm-row-title-flex">
            {tokenAbbr}
            <button className="farm-copy-btn farm-copy-btn-token" onClick={handleCopyMint} title="Copy Token Mint">
              {copiedMint ? <span className="farm-copy-status">✓</span> : <img src={copyIcon} alt="copy" />}
            </button>
          </strong>
        </div>
        <div className="farm-row-col">
          <span className="farm-row-label">Period</span>
          <strong className="farm-row-value farm-period-value" title={periodDates.detailed} style={{ cursor: 'pointer' }}>
            {periodDates.short}
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
          <span className={`position-status-badge ${isEnded ? 'out-range' : isUpcoming ? 'upcoming' : 'in-range'} farm-row-status-badge`}>
            <span className="status-dot"></span>
            {isEnded ? 'Ended' : isUpcoming ? 'Upcoming' : 'Active'}
          </span>
        </div>
        <div className="farm-row-actions">
          <button
            className={`pos-btn collect-rewards-btn farm-row-btn ${busy || !isEnded || unemitted <= 0 ? 'farm-row-btn-disabled' : ''}`}
            onClick={handleReclaimFunds}
            disabled={busy || !isEnded || unemitted <= 0}
            title={!isEnded ? "Campaign must end before reclaiming funds." : unemitted <= 0 ? "No remaining rewards to collect." : ""}
          >
            {busy ? 'Processing...' : 'Collect Remaining Rewards'}
          </button>
          <button
            className="pos-btn pos-btn-deposit farm-row-btn"
            onClick={() => setIsEditing(!isEditing)}
            disabled={busy || (!isStarted && !isAdmin)}
            title={(!isStarted && !isAdmin) ? "Cannot edit farm before it has opened." : ""}
          >
            {isEditing ? 'Cancel Edit' : 'Edit Farm'}
          </button>
        </div>
      </div>

      {isEditing && typeof document !== 'undefined' && createPortal(
        <div className="portfolio-modal-overlay">
          <div className="portfolio-modal-backdrop" onClick={() => setIsEditing(false)} />
          <div className="portfolio-modal-content farm-edit-modal">
            <button className="portfolio-modal-close" onClick={() => setIsEditing(false)}>✕</button>
            <div className="portfolio-modal-header">
              <h2>Edit Farm: {t0Name} - {t1Name}</h2>
              <p className="portfolio-subtitle">Update parameters for your {tokenAbbr} reward farm.</p>
            </div>
            <div className="portfolio-modal-body farm-edit-body">
              {isActive && (
                <div className="farm-edit-note">
                  <strong>Note:</strong> You must extend the End Time by at least 7 days from its current end time. You cannot decrease the reward rate unless the farm is within 72 hours of ending.
                </div>
              )}
              <div className="farm-edit-period-section">
                <div className="farm-edit-field-group">
                  <label className="farm-edit-label">
                    {isActive ? 'Extend Duration (Days)' : 'Farm Period'}
                  </label>
                  <div className="farm-edit-period-row">
                    <div className="farm-edit-period-input">
                      {isActive ? (
                        <input
                          type="number"
                          min="7"
                          className="farm-edit-input portfolio-search-bar"
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
                    <div className="farm-duration-summary">
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

              <div className="farm-edit-field-group">
                <div className="farm-edit-label-row">
                  <label className="farm-edit-label">Rewards Per Week</label>
                  <button
                    className="farm-reset-btn"
                    onClick={() => setFormData(p => ({ ...p, rewardsPerWeek: initialRewardsPerWeek }))}
                    disabled={busy}
                  >
                    Reset
                  </button>
                </div>
                <input
                  type="number"
                  className="farm-edit-input portfolio-search-bar"
                  placeholder="e.g. 1000"
                  value={formData.rewardsPerWeek}
                  onChange={e => setFormData(p => ({ ...p, rewardsPerWeek: e.target.value }))}
                  disabled={busy}
                />
              </div>

              {!validationError && calculateTotalTokens() > 0 && (
                <div className="farm-total-required">
                  <strong>{isActive ? 'Extra Required:' : 'Total Required:'}</strong> {calculateTotalTokens().toFixed(4)} tokens
                  {isEnded && ` (over ${calculateDurationDays().toFixed(1)} days)`}
                </div>
              )}

              {validationError && (
                <div className="farm-validation-error">
                  ⚠️ {validationError}
                </div>
              )}

              <div className="farm-edit-actions">
                <button
                  className="pos-btn pos-btn-withdraw"
                  onClick={() => setIsEditing(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="pos-btn pos-btn-harvest"
                  onClick={handleUpdateRewardParams}
                  disabled={busy || !!validationError}
                >
                  {busy ? 'Processing...' : 'Save Parameters'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {txState && typeof document !== 'undefined' && createPortal(
        <TxSmallCard
          status={txState.status}
          title={txState.title}
          description={txState.message}
          details={txState.details}
          signature={txState.signature || null}
          onClose={() => setTxState(null)}
        />,
        document.body
      )}
    </div>
  );
}

export default function Farms() {
  const { publicKey } = useWallet();
  const { pools, loadingPools } = usePools();
  const navigate = useNavigate();

  if (loadingPools && pools.length === 0) {
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
      <div className="farm-page-header">
        <h2 className="farm-page-title">My Managed Farms</h2>
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

import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';

import { usePools, PoolRowData } from '../../contexts/PoolsContext';
import { usePositionsContext } from '../../contexts/PositionsContext';
import { useTransactions } from '../../contexts/TxContext';
import useProgram from '../../utils/useProgram';
import { getOperationAccountAddress, getPoolRewardVaultAddress } from '../../utils/pda';
import TxSmallCard from '../../components/TxSmallCard/TxSmallCard';
import FarmPeriodPicker from '../../components/FarmPeriodPicker/FarmPeriodPicker';
import copyIcon from '../../assets/copy.svg';
import './CreateFarm.css';

interface RewardForm {
  tokenMint: string;
  openTime: string;
  endTime: string;
  rewardsPerWeek: string;
}

const formatToDDMMYYYY = (dateString: string) => {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function CreateFarm() {
  const navigate = useNavigate();
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { pools, loadingPools, refreshPools } = usePools();
  const { refreshPositions } = usePositionsContext();
  const { addTransaction } = useTransactions();

  const [step, setStep] = useState(1);
  const [selectedPool, setSelectedPool] = useState<PoolRowData | null>(null);
  
  const [rewards, setRewards] = useState<RewardForm[]>([
    { tokenMint: '', openTime: '', endTime: '', rewardsPerWeek: '' }
  ]);

  const [busy, setBusy] = useState(false);
  const [copiedPool, setCopiedPool] = useState<string | null>(null);
  const [txState, setTxState] = useState<{status: 'error' | 'success', title: string, message: string, details?: string, signature?: string} | null>(null);

  const [isNoteExpanded, setIsNoteExpanded] = useState(false);
  const [showMoreButton, setShowMoreButton] = useState(false);
  const noteTextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (noteTextRef.current) {
      if (noteTextRef.current.scrollHeight > 150) {
        setShowMoreButton(true);
      }
    }
  }, []);

  // Filter pools to only those created by the current user
  const myPools = pools.filter(p => p.poolCreator === publicKey?.toBase58());

  const handleNext = () => {
    if (step === 1 && selectedPool) {
      const activeRewards = selectedPool.rewardInfos?.filter(r => r.initialized).length || 0;
      if (activeRewards >= 3) {
        alert("This pool already has the maximum of 3 active rewards.");
        return;
      }
    }
    setStep(s => Math.min(s + 1, 3));
  };
  const handleBack = () => setStep(s => Math.max(s - 1, 1));

  const updateReward = (index: number, field: keyof RewardForm, value: string) => {
    const newRewards = [...rewards];
    newRewards[index][field] = value;
    setRewards(newRewards);
  };

  const calculateDurationDays = (openTime: string, endTime: string) => {
    if (!openTime || !endTime) return 0;
    const start = new Date(openTime).getTime();
    const end = new Date(endTime).getTime();
    if (end <= start) return 0;
    return (end - start) / (1000 * 60 * 60 * 24);
  };

  const calculateTotalTokens = (reward: RewardForm) => {
    const days = calculateDurationDays(reward.openTime, reward.endTime);
    if (!days || !reward.rewardsPerWeek) return 0;
    const rewardsPerDay = parseFloat(reward.rewardsPerWeek) / 7;
    return rewardsPerDay * days;
  };

  const isFormValid = () => {
    if (rewards.some(r => !r.tokenMint || !r.openTime || !r.endTime || !r.rewardsPerWeek)) return false;
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i];
      const requiredAmount = calculateTotalTokens(reward);
      if (requiredAmount <= 0) return false;
      const now = Math.floor(Date.now() / 1000);
      let openTime = Math.floor(new Date(reward.openTime).getTime() / 1000);
      let endTime = Math.floor(new Date(reward.endTime).getTime() / 1000);
      if (openTime <= now + 10) {
        const shift = (now + 60) - openTime;
        openTime += shift;
        endTime += shift;
      }
      if (endTime <= openTime) return false;
      if (endTime - openTime < 7 * 86400 || endTime - openTime > 90 * 86400) return false;
      
      if (selectedPool) {
        const usedMints = selectedPool.rewardInfos?.filter(r => r.initialized).map(r => r.tokenMint) || [];
        if (usedMints.includes(reward.tokenMint)) return false;
      }
    }
    return true;
  };

  const isStepClickable = (targetStep: number) => {
    if (targetStep === 1) return true;
    if (targetStep === 2) {
      if (!selectedPool) return false;
      const activeRewards = selectedPool.rewardInfos?.filter(r => r.initialized).length || 0;
      return activeRewards < 3;
    }
    if (targetStep === 3) {
      if (!selectedPool) return false;
      const activeRewards = selectedPool.rewardInfos?.filter(r => r.initialized).length || 0;
      return activeRewards < 3 && isFormValid();
    }
    return false;
  };

  const handleStepClick = (targetStep: number) => {
    if (isStepClickable(targetStep)) {
      setStep(targetStep);
    }
  };

  const handleCopyPool = (e: React.MouseEvent, poolAddress: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(poolAddress);
    setCopiedPool(poolAddress);
    setTimeout(() => setCopiedPool(null), 2000);
  };

  const checkBalance = async (mint: string, requiredTokens: number): Promise<boolean> => {
    if (!publicKey) return false;
    try {
      const mintKey = new PublicKey(mint);
      
      let tokenProgramId = TOKEN_PROGRAM_ID;
      try {
        const mintInfo = await connection.getParsedAccountInfo(mintKey);
        if (mintInfo.value?.owner) tokenProgramId = mintInfo.value.owner;
      } catch (e) {}

      const ata = getAssociatedTokenAddressSync(mintKey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
      const balanceInfo = await connection.getTokenAccountBalance(ata);
      
      if (balanceInfo.value.uiAmount !== null) {
        return balanceInfo.value.uiAmount >= requiredTokens;
      }
    } catch (e) {
      console.error(e);
      return false; // Error or account doesn't exist (balance 0)
    }
    return false;
  };

  const handleCreateFarm = async () => {
    if (!program || !publicKey || !signTransaction || !selectedPool) return;
    setBusy(true);
    setTxState(null);

    try {
      // Step 1: Pre-flight checks and math
      const instructions = [];
      const poolPda = new PublicKey(selectedPool.poolPda);
      const ammConfig = new PublicKey(selectedPool.ammConfig);
      const operationState = getOperationAccountAddress(program.programId)[0];

      for (let i = 0; i < rewards.length; i++) {
        const reward = rewards[i];
        if (!reward.tokenMint || !reward.openTime || !reward.endTime || !reward.rewardsPerWeek) {
          throw new Error(`Reward ${i + 1} has missing fields.`);
        }

        const requiredAmount = calculateTotalTokens(reward);
        if (requiredAmount <= 0) throw new Error(`Reward ${i + 1} duration or amount is invalid.`);

        const hasBalance = await checkBalance(reward.tokenMint, requiredAmount);
        if (!hasBalance) {
          throw new Error(`Insufficient balance for Reward Token ${i + 1}. You need at least ${requiredAmount.toFixed(4)} tokens.`);
        }

        const now = Math.floor(Date.now() / 1000);
        let openTime = Math.floor(new Date(reward.openTime).getTime() / 1000);
        let endTime = Math.floor(new Date(reward.endTime).getTime() / 1000);
        
        // Pad the open time if it's already in the past due to UI delays
        if (openTime <= now + 10) {
          const shift = (now + 60) - openTime;
          openTime += shift;
          endTime += shift;
        }
        
        if (endTime <= openTime) {
          throw new Error(`Reward ${i + 1} end time is too close or in the past.`);
        }
        
        const MIN_REWARD_PERIOD = 7 * 86400;
        const MAX_REWARD_PERIOD = 90 * 86400;
        const duration = endTime - openTime;
        
        if (duration < MIN_REWARD_PERIOD || duration > MAX_REWARD_PERIOD) {
          throw new Error(`Reward ${i + 1} duration must be between 7 and 90 days.`);
        }
        
        const usedMints = selectedPool.rewardInfos?.filter(r => r.initialized).map(r => r.tokenMint) || [];
        if (usedMints.includes(reward.tokenMint)) {
          throw new Error(`Reward token ${reward.tokenMint.slice(0, 4)} is already in use by this pool.`);
        }
        
        const rewardMintKey = new PublicKey(reward.tokenMint);
        let mintDecimals = 6;
        let tokenProgramId = TOKEN_PROGRAM_ID;
        
        const mintInfo = await connection.getParsedAccountInfo(rewardMintKey);
        if (mintInfo.value?.owner) tokenProgramId = mintInfo.value.owner;
        // @ts-ignore
        if (mintInfo.value?.data?.parsed?.info?.decimals !== undefined) {
          // @ts-ignore
          mintDecimals = mintInfo.value.data.parsed.info.decimals;
        }

        const tokensPerSecond = requiredAmount / ((endTime - openTime));
        const rawTokensPerSecond = tokensPerSecond * Math.pow(10, mintDecimals);
        const integerPart = Math.floor(rawTokensPerSecond);
        const Q64 = new BN(1).ushln(64);
        const emissionsPerSecondX64 = new BN(integerPart).mul(Q64);

        const funderTokenAccount = getAssociatedTokenAddressSync(rewardMintKey, publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
        const rewardTokenVault = getPoolRewardVaultAddress(poolPda, rewardMintKey, program.programId)[0];

        const ix = await program.methods.initializeReward({
          openTime: new BN(openTime),
          endTime: new BN(endTime),
          emissionsPerSecondX64
        }).accounts({
          rewardFunder: publicKey,
          funderTokenAccount,
          ammConfig,
          poolState: poolPda,
          operationState,
          rewardTokenMint: rewardMintKey,
          rewardTokenVault,
          rewardTokenProgram: tokenProgramId,
          systemProgram: new PublicKey('11111111111111111111111111111111'),
          rent: new PublicKey('SysvarRent111111111111111111111111111111111')
        }).instruction();

        instructions.push(ix);
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction();
      instructions.forEach(ix => tx.add(ix));
      tx.feePayer = publicKey;
      tx.recentBlockhash = blockhash;

      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      addTransaction(signature, `Created Farm with ${rewards.length} rewards`);
      setTxState({ status: 'success', title: 'Farm Created!', message: 'Your farming campaign is now live.', signature });
      
      refreshPools();
      refreshPositions();
      
      setTimeout(() => navigate('/portfolio'), 2000);
    } catch (err: any) {
      console.error(err);
      setTxState({ 
        status: 'error', 
        title: 'Failed to create farm', 
        message: 'Transaction failed to confirm on network.', 
        details: err.message || err.toString() 
      });
    } finally {
      setBusy(false);
    }
  };

  const addressToColor = (addr: string) => {
    const hash = addr.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0);
    return `hsl(${hash % 360},70%,58%)`;
  };

  return (
    <div className="cf-page">
      <div className="cf-main">
        {/* Sidebar Stepper */}
        <div className="cf-sidebar">
          <button className="cf-back-btn" onClick={() => step > 1 ? handleBack() : navigate(-1)}>
            <span className="cf-back-icon">&lsaquo;</span> Back
          </button>
          <div className="cf-stepper">
            <div 
              className={`cf-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''} ${isStepClickable(1) ? 'clickable' : ''}`}
              onClick={() => handleStepClick(1)}
            >
              <div className="cf-step-icon">{step > 1 ? '✓' : '1'}</div>
              <div className="cf-step-content">
                <span className="cf-step-title">Step 1</span>
                <span className="cf-step-desc">Select Pool</span>
              </div>
            </div>
            
            <div 
              className={`cf-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''} ${isStepClickable(2) ? 'clickable' : ''}`}
              onClick={() => handleStepClick(2)}
            >
              <div className="cf-step-icon">{step > 2 ? '✓' : '2'}</div>
              <div className="cf-step-content">
                <span className="cf-step-title">Step 2</span>
                <span className="cf-step-desc">Add Rewards</span>
              </div>
            </div>
            
            <div 
              className={`cf-step ${step >= 3 ? 'active' : ''} ${isStepClickable(3) ? 'clickable' : ''}`}
              onClick={() => handleStepClick(3)}
            >
              <div className="cf-step-icon">3</div>
              <div className="cf-step-content">
                <span className="cf-step-title">Step 3</span>
                <span className="cf-step-desc">Review Farm Detail</span>
              </div>
            </div>
          </div>

          <div className="cf-note-card">
            <div className="cf-note-title">
              <span className='cf-note-exclamation'>!</span>
              Please Note
            </div>
            <div 
              className={`cf-note-text ${showMoreButton ? (isNoteExpanded ? 'expanded' : 'collapsed') : ''}`}
              ref={noteTextRef}
            >
              Farms can be created for any live pool. Reward allocations remain locked until the farming period ends. The first reward accepts pool tokens, approved whitelist tokens, or any token without a freeze authority. If neither pool token is used as the first reward, the second reward must be a pool token or an approved whitelist token. The third reward slot is reserved exclusively for the Admin or an approved Operation Owner.
            </div>
            {showMoreButton && (
              <button 
                className="cf-note-show-more" 
                onClick={() => setIsNoteExpanded(!isNoteExpanded)}
              >
                {isNoteExpanded ? 'show less' : 'show more...'}
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="cf-content">
          
          {step === 1 && (
            <div>
              <div className="cf-title">First, select a pool for farm rewards</div>
              <div className="cf-card">
                <h3 style={{ margin: '0 0 20px 0', fontSize: '18px' }}>Select Pool</h3>
                <p style={{ color: '#7a8fa6', fontSize: '14px', marginBottom: '16px' }}>Select from your created pools:</p>
                
                {loadingPools ? (
                  <p>Loading your pools...</p>
                ) : myPools.length === 0 ? (
                  <p style={{ color: '#7a8fa6' }}>You haven't created any pools yet. <Link to="/liquidity/create" style={{ color: '#39d0d8', textDecoration: 'none' }}>Create a new pool</Link></p>
                ) : (
                  <div className="cf-pool-select-wrap">
                    {myPools.map(pool => {
                      const t0Name = pool.tokenMint0.slice(0, 4).toUpperCase();
                      const t1Name = pool.tokenMint1.slice(0, 4).toUpperCase();
                      return (
                        <div 
                          key={pool.poolPda} 
                          className={`cf-pool-card ${selectedPool?.poolPda === pool.poolPda ? 'selected' : ''}`}
                          onClick={() => setSelectedPool(pool)}
                        >
                          <div className="cf-pool-icons">
                            <div className="cf-pool-icon" style={{ background: addressToColor(pool.tokenMint0), zIndex: 1 }}>{t0Name}</div>
                            <div className="cf-pool-icon" style={{ background: addressToColor(pool.tokenMint1) }}>{t1Name}</div>
                          </div>
                          <div className="cf-pool-info">
                            <div className="cf-pool-name">{t0Name} - {t1Name}</div>
                            <div className="cf-pool-id">
                              Pool Address: <span className="cf-pool-cyan">{pool.poolPda.slice(0, 4)}...{pool.poolPda.slice(-4)}</span>
                              <button className="cf-copy-btn" onClick={(e) => handleCopyPool(e, pool.poolPda)} title="Copy Pool Address">
                                {copiedPool === pool.poolPda ? <span className="cf-copy-check">✓</span> : <img className="cf-copy-icon" src={copyIcon} alt="copy" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="cf-actions">
                  <button 
                    className="cf-btn-next" 
                    onClick={handleNext} 
                    disabled={!selectedPool}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="cf-title">
                Next, enter rewards for the farm
              </div>
              
              {rewards.map((reward, index) => {
                const totalTokens = calculateTotalTokens(reward);
                const days = calculateDurationDays(reward.openTime, reward.endTime);
                
                return (
                  <div key={index} className="cf-reward-box">
                    <div className="cf-reward-header">
                      <span>Reward Token</span>
                    </div>
                    
                    <div className="cf-input-group">
                      <span className="cf-label">Reward Token Mint</span>
                      <input 
                        className="cf-input" 
                        placeholder="Paste SPL Token Mint Address" 
                        value={reward.tokenMint}
                        onChange={(e) => updateReward(index, 'tokenMint', e.target.value)}
                      />
                    </div>

                    <div className="cf-input-group cf-dates-row" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <span className="cf-label">Farm Period</span>
                        <FarmPeriodPicker 
                          startTime={reward.openTime}
                          endTime={reward.endTime}
                          onChange={(start, end) => {
                            updateReward(index, 'openTime', start);
                            updateReward(index, 'endTime', end);
                          }}
                        />
                      </div>
                      <div className="cf-duration" style={{ flex: 'none', margin: '0 16px' }}>
                        {days > 0 ? `${days.toFixed(1)} Days` : '- Days'}
                      </div>
                    </div>

                    <div className="cf-input-group">
                      <span className="cf-label">Estimated rewards / week</span>
                      <input 
                        type="number" 
                        className="cf-input" 
                        placeholder="0.00" 
                        value={reward.rewardsPerWeek}
                        onChange={(e) => updateReward(index, 'rewardsPerWeek', e.target.value)}
                      />
                    </div>

                    {totalTokens > 0 && (
                      <div style={{ marginTop: '16px', fontSize: '14px', color: '#39d0d8', background: 'rgba(57, 208, 216, 0.05)', padding: '12px', borderRadius: '8px' }}>
                        <strong>Total Required:</strong> {totalTokens.toFixed(4)} tokens (will be balance checked on next step)
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="cf-actions">
                <button 
                  className="cf-btn-next" 
                  onClick={handleNext}
                  disabled={!isFormValid()}
                >
                  Next Step
                </button>
              </div>
            </div>
          )}

          {step === 3 && selectedPool && (
            <div>
              <div className="cf-title">Review Farm Detail</div>
              <div className="cf-card">
                
                <div className="cf-review-row">
                  <span className="cf-review-label">Pool</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="cf-review-value">
                      {selectedPool.tokenMint0.slice(0, 4).toUpperCase()} - {selectedPool.tokenMint1.slice(0, 4).toUpperCase()}
                    </span>
                    <span style={{ color: '#7a8fa6', fontSize: '13px' }}>
                      ({selectedPool.poolPda.slice(0, 4)}...{selectedPool.poolPda.slice(-4)})
                    </span>
                    <button className="cf-copy-btn" onClick={(e) => handleCopyPool(e, selectedPool.poolPda)} title="Copy Pool Address">
                      {copiedPool === selectedPool.poolPda ? <span className="cf-copy-check">✓</span> : <img className="cf-copy-icon" src={copyIcon} alt="copy" />}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: '30px', marginBottom: '16px', color: '#e6f0ff', fontWeight: 600 }}>Farming rewards</div>
                
                {rewards.map((reward, i) => (
                  <div key={i} className="cf-review-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="cf-review-label">Token Mint</span>
                      <span className="cf-review-value">{reward.tokenMint.slice(0, 8)}...{reward.tokenMint.slice(-8)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="cf-review-label">Rewards / Week</span>
                      <span className="cf-review-value">{reward.rewardsPerWeek}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="cf-review-label">Duration</span>
                      <span className="cf-review-value">
                        {formatToDDMMYYYY(reward.openTime)} - {formatToDDMMYYYY(reward.endTime)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="cf-review-label">Total Deposit Required</span>
                      <span className="cf-review-value" style={{ color: '#39d0d8' }}>{calculateTotalTokens(reward).toFixed(4)}</span>
                    </div>
                  </div>
                ))}

                {txState && (
                  <div style={{ marginTop: '20px' }}>
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

                <div className="cf-actions">
                  <button className="cf-btn-next" onClick={handleCreateFarm} disabled={busy || !isFormValid()}>
                    {busy ? 'Creating...' : 'Create Farm'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

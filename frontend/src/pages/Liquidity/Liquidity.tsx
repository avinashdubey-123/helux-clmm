import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Liquidity.css";
import copyIcon from "../../assets/copy.svg";
import swapIcon from "../../assets/swap.svg";
import { usePools, PoolRowData } from "../../contexts/PoolsContext";
import Loader from "../../components/Loader/Loader";
import InlineLoader from "../../components/InlineLoader/InlineLoader";
import { batchFetchPoolData } from "../../utils/batchFetch";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  checkAndClearPoolsRefetch,
  getCachedPoolData,
} from "../../utils/cache";
import useProgram from "../../utils/useProgram";
import { PublicKey } from "@solana/web3.js";

const formatBalance = (amount?: number | null, decimals = 6) => {
  if (amount == null) return "-";
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(6, decimals),
    maximumFractionDigits: Math.min(6, decimals),
  });
};

const addressToColor = (addr: string) => {
  const hash = addr
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0);
  const hue = hash % 360;
  return `hsl(${hue},70%,58%)`;
};

function PoolRow({ pool, navigate }: { pool: PoolRowData; navigate: any }) {
  const [hoverInfo, setHoverInfo] = useState<{
    poolId?: string | null;
    token0?: string | null;
    token1?: string | null;
  } | null>(null);
  const hoverTimeout = useRef<number | null>(null);

  useEffect(() => {
    // BUG FIX: Removed concurrent per-row RPC fetching to prevent 429 Too Many Requests
    // The UI will rely on the cached pool.liquidity or pool.vault0Balance provided by the Context instead.
  }, []);

  const token0Name = pool.tokenMint0.slice(0, 4).toUpperCase();
  const token1Name = pool.tokenMint1.slice(0, 4).toUpperCase();
  const displayName = `${token0Name}-${token1Name}`;

  let liquidityDisplay;
  if (pool.isActiveLiquidityLoading) {
    liquidityDisplay = <InlineLoader />;
  } else if (pool.activeLiquidity0 != null && pool.activeLiquidity1 != null) {
    liquidityDisplay = `${formatBalance(pool.activeLiquidity0, pool.mintDecimals0)} ${token0Name} & ${formatBalance(pool.activeLiquidity1, pool.mintDecimals1)} ${token1Name}`;
  } else {
    liquidityDisplay = "...";
  }

  const token0Color = addressToColor(pool.tokenMint0);
  const token1Color = addressToColor(pool.tokenMint1);

  const clearHoverTimeout = () => {
    if (hoverTimeout.current != null) {
      window.clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
  };

  const [copiedText, setCopiedText] = useState<string | null>(null);
  
  const handleIconEnter = (pool: PoolRowData) => {
    clearHoverTimeout();
    setHoverInfo({
      poolId: pool.poolPda,
      token0: pool.tokenMint0,
      token1: pool.tokenMint1,
    });
  };

  const handleIconLeave = () => {
    clearHoverTimeout();
    hoverTimeout.current = window.setTimeout(() => setHoverInfo(null), 150);
  };

  const copyText = async (value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedText(value);
      setTimeout(() => setCopiedText(null), 2000);
    } catch (error) {}
  };

  const onDeposit = () => {
    try {
      navigate("/liquidity/deposit", { state: { pool } });
    } catch {
      navigate("/liquidity/deposit");
    }
  };

  const onSwap = () => {
    try {
      navigate("/swap", { state: { pool } });
    } catch {
      navigate("/swap");
    }
  };

  return (
    <tr key={pool.poolPda} className="lp-row">
      <td className="lp-td lp-td-pool lp-col-pool">
        <div className="lp-td-pool-inner">
          <div
            className="lp-hover-wrapper"
            onMouseEnter={() => {
              handleIconEnter(pool);
            }}
            onMouseLeave={handleIconLeave}
            style={{ display: "inline-block" }}
          >
            <div
              className="lp-pool-icons"
              style={{ cursor: "pointer" }}
              title="Hover to view pool info"
            >
              <span
                className="lp-icon lp-icon-a"
                style={{ background: token0Color, zIndex: 1 }}
              >
                {token0Name.slice(0, 4)}
              </span>
              <span
                className="lp-icon lp-icon-b"
                style={{ background: token1Color }}
              >
                {token1Name.slice(0, 4)}
              </span>
            </div>
            {hoverInfo && (
              <div className="lp-hover-card">
                <div className="lp-hover-row">
                  <span>
                    <strong>Pool ID:</strong> {hoverInfo.poolId ?? "unknown"}
                  </span>
                  <button
                    className="lp-copy-btn"
                    onClick={() => copyText(hoverInfo.poolId)}
                    title="Copy pool id"
                    aria-label="Copy pool id"
                  >
                    {copiedText === hoverInfo.poolId ? <span style={{color: '#39d0d8', fontWeight: 'bold'}}>✓</span> : <img src={copyIcon} alt="Copy" />}
                  </button>
                </div>
                <div className="lp-hover-row">
                  <span>
                    <strong>Token0:</strong> {hoverInfo.token0 ?? "-"}
                  </span>
                  <button
                    className="lp-copy-btn"
                    onClick={() => copyText(hoverInfo.token0)}
                    title="Copy token0"
                    aria-label="Copy token0"
                  >
                    {copiedText === hoverInfo.token0 ? <span style={{color: '#39d0d8', fontWeight: 'bold'}}>✓</span> : <img src={copyIcon} alt="Copy" />}
                  </button>
                </div>
                <div className="lp-hover-row">
                  <span>
                    <strong>Token1:</strong> {hoverInfo.token1 ?? "-"}
                  </span>
                  <button
                    className="lp-copy-btn"
                    onClick={() => copyText(hoverInfo.token1)}
                    title="Copy token1"
                    aria-label="Copy token1"
                  >
                    {copiedText === hoverInfo.token1 ? <span style={{color: '#39d0d8', fontWeight: 'bold'}}>✓</span> : <img src={copyIcon} alt="Copy" />}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="lp-pool-info">
            <span className="lp-pool-name">{displayName}</span>
          </div>
        </div>
      </td>
      <td className="lp-td lp-col-liquidity">{liquidityDisplay}</td>
      <td className="lp-td lp-col-fee">
        {((pool.tradeFeeRate || 0) / 10000).toFixed(2)}%
      </td>
      <td className="lp-td lp-td-actions lp-col-actions">
        <div className="lp-row-actions">
          <div className="lp-swap-tooltip-wrapper">
            <button className="lp-swap-btn" onClick={onSwap} title="Swap">
              <img
                src={swapIcon}
                alt="Swap"
                style={{ width: "16px", height: "16px" }}
              />
            </button>
            <span className="lp-swap-tooltip-text">Swap</span>
          </div>
          <button className="lp-deposit-btn" onClick={onDeposit}>
            Deposit
          </button>
        </div>
      </td>
    </tr>
  );
}

const Liquidity = () => {
  const navigate = useNavigate();
  const { pools, loadingPools, poolsError } = usePools();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useProgram();

  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return sessionStorage.getItem("liquidity_searchQuery") || "";
    } catch {
      return "";
    }
  });

  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [displayPools, setDisplayPools] = useState<PoolRowData[]>([]);

  useEffect(() => {
    try {
      sessionStorage.setItem("liquidity_searchQuery", searchQuery);
    } catch {}
  }, [searchQuery]);

  // Progressive batch loading logic
  useEffect(() => {
    if (publicKey && checkAndClearPoolsRefetch(publicKey.toBase58())) {
      setDisplayPools([]);
    }

    let cancelled = false;

    const loadBatches = async () => {
      if (!pools || pools.length === 0) {
        if (!cancelled) setDisplayPools([]);
        return;
      }

      // Check if all pools are already cached — if so, skip the loading indicator
      const allCached = pools.every((p) => getCachedPoolData(p.poolPda));
      if (!allCached) {
        setIsBatchLoading(true);
      }
      const pgmId = program
        ? (program as any).programId
        : new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
      const batchSize = 10;
      const newDisplayPools: PoolRowData[] = [];

      for (let i = 0; i < pools.length; i += batchSize) {
        if (cancelled) break;
        const batch = pools.slice(i, i + batchSize);
        const enrichedBatch = await batchFetchPoolData(
          connection,
          pgmId,
          batch,
        );
        if (cancelled) break;

        newDisplayPools.push(...enrichedBatch);
        // Progressively update state
        setDisplayPools([...newDisplayPools]);

        // Short delay between batches
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!cancelled) {
        setIsBatchLoading(false);
      }
    };

    loadBatches();

    return () => {
      cancelled = true;
    };
  }, [pools, connection, program]);

  const poolCount = useMemo(() => (pools ? pools.length : 0), [pools]);

  const filteredPools = useMemo(() => {
    if (!searchQuery) return displayPools;
    const q = searchQuery.toLowerCase();
    return displayPools.filter((p) => {
      const name =
        `${p.tokenMint0.slice(0, 4)}-${p.tokenMint1.slice(0, 4)}`.toLowerCase();
      return (
        p.poolPda.toLowerCase().includes(q) ||
        name.includes(q) ||
        p.tokenMint0.toLowerCase().includes(q) ||
        p.tokenMint1.toLowerCase().includes(q)
      );
    });
  }, [displayPools, searchQuery]);

  return (
    <div className="lp-page">
      <div className="lp-top">
        <div className="lp-top-left">
          <h1 className="lp-title">Liquidity Pools</h1>
          <p className="lp-subtitle">Provide liquidity, earn yield.</p>
        </div>

        <div className="lp-stats">
          <div className="lp-stat-card">
            <span className="lp-stat-label">Total Number of Pools</span>
            <span className="lp-stat-value">
              {loadingPools && poolCount === 0
                ? "Loading..."
                : `${poolCount} Pools`}
            </span>
          </div>
        </div>
      </div>

      <div className="lp-filter-bar">
        <div className="lp-filter-left">
          <input
            className="lp-search"
            placeholder="Search pool name or id..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="lp-filter-right" style={{ display: 'flex', gap: '12px' }}>
          <button
            className="lp-create-btn"
            onClick={() => navigate("/liquidity/create-farm")}
            style={{ background: 'transparent', border: '1px solid #aa3bff', color: '#aa3bff' }}
          >
            Create Farm
          </button>
          <button
            className="lp-create-btn"
            onClick={() => navigate("/liquidity/create")}
          >
            Create Pool
          </button>
        </div>
      </div>

      <div className="lp-table-wrap">
        <table className="lp-table">
          <thead>
            <tr>
              <th className="lp-th lp-th-pool lp-col-pool">Pool</th>
              <th className="lp-th lp-col-liquidity">Liquidity</th>
              <th className="lp-th lp-col-fee">Fee Tier</th>
              <th className="lp-th lp-col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingPools && pools.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{ textAlign: "center", padding: "40px 0" }}
                >
                  <Loader size={36} />
                </td>
              </tr>
            ) : poolsError ? (
              <tr>
                <td colSpan={4}>Error: {poolsError}</td>
              </tr>
            ) : filteredPools.length === 0 && !isBatchLoading ? (
              <tr>
                <td colSpan={4}>No pools found.</td>
              </tr>
            ) : (
              <>
                {filteredPools.map((pool) => (
                  <PoolRow key={pool.poolPda} pool={pool} navigate={navigate} />
                ))}
                {isBatchLoading && (
                  <tr className="lp-loading-more-row">
                    <td colSpan={4}>
                      <div className="lp-loading-more lp-loading-more-centered">
                        <InlineLoader />
                        <span className="lp-loading-more-text">
                          Loading more...
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="lp-note">Deposit to any of the pools as you wish.</p>
    </div>
  );
};

export default Liquidity;

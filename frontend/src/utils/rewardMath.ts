import { PositionRowData } from '../hooks/usePositions';
import { PoolRowData } from '../contexts/PoolsContext';

const Q64 = 1n << 64n;
const U128_MAX = (1n << 128n) - 1n;

// Floor division for Q64.64 math
function mulDivFloor(a: bigint, b: bigint, denominator: bigint): bigint {
  return (a * b) / denominator;
}

// 1️⃣ Get fresh global growth
function freshGlobalGrowth(
  global: bigint,
  lastUpdate: number,
  emissionsPerSecX64: bigint,
  poolLiquidity: bigint,
  nowSec: number
): bigint {
  const elapsed = BigInt(Math.max(0, nowSec - lastUpdate));
  if (elapsed === 0n || poolLiquidity === 0n) return global;
  const added = mulDivFloor(
    elapsed * emissionsPerSecX64,
    1n,
    poolLiquidity
  );
  return (global + added) & U128_MAX;
}

// 2️⃣ Reward-growth-inside (same as Rust)
function growthInside(
  currentTick: number,
  lowerTickIdx: number,
  upperTickIdx: number,
  global: bigint,
  lowerOutside: bigint,
  upperOutside: bigint
): bigint {
  if (currentTick < lowerTickIdx) {
    // price below range
    return (lowerOutside - upperOutside) & U128_MAX;
  } else if (currentTick >= upperTickIdx) {
    // price above range
    return (upperOutside - lowerOutside) & U128_MAX;
  } else {
    // inside range
    return (global - lowerOutside - upperOutside) & U128_MAX;
  }
}

// 3️⃣ Full pending-reward calculation (per reward token)
export function getRealTimePendingReward(
  position: PositionRowData,
  pool: PoolRowData,
  rewardIndex: number,
  nowSec = Math.floor(Date.now() / 1000)
): number {
  if (!pool.rewardInfos || !pool.rewardInfos[rewardIndex] || !position.rewardInfos[rewardIndex]) {
    return 0;
  }

  const poolRewardInfo = pool.rewardInfos[rewardIndex];
  const posRewardInfo = position.rewardInfos[rewardIndex];

  if (!poolRewardInfo.initialized) return 0;

  const globalFresh = freshGlobalGrowth(
    BigInt(poolRewardInfo.rewardGrowthGlobalX64 || "0"),
    poolRewardInfo.lastUpdateTime || 0,
    BigInt(poolRewardInfo.emissionsPerSecondX64 || "0"),
    BigInt(pool.liquidity || "0"),
    nowSec
  );

  const lowerOutside = BigInt(position.lowerTickOutsideGrowthX64?.[rewardIndex] || "0");
  const upperOutside = BigInt(position.upperTickOutsideGrowthX64?.[rewardIndex] || "0");

  const inside = growthInside(
    pool.tickCurrent,
    position.tickLower,
    position.tickUpper,
    globalFresh,
    lowerOutside,
    upperOutside
  );

  let delta = inside - BigInt(posRewardInfo.growthInsideLastX64);
  
  // Handle wrapping / underflow
  if (delta < 0n) {
    delta += (1n << 128n);
  }
  
  // If delta is excessively large (> 2^127), it's a negative underflow caused by
  // slight off-chain sync lag. We cap it to 0 to prevent displaying massive numbers.
  if (delta > (1n << 127n)) {
    delta = 0n;
  }

  const newlyEarned = mulDivFloor(
    delta,
    BigInt(position.liquidity),
    Q64
  );

  const totalOwed = BigInt(posRewardInfo.rewardAmountOwed) + newlyEarned;
  
  return Number(totalOwed);
}

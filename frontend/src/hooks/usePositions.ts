
export type PositionRowData = {
  positionPda: string
  nftMint: string
  poolId: string
  tickLower: number
  tickUpper: number
  liquidity: string
  feeGrowthInside0Last: string
  feeGrowthInside1Last: string
}

import { usePositionsContext } from '../contexts/PositionsContext'

export function usePositions() {
  return usePositionsContext()
}

export function getTokensFromLiquidity(
  liquidity: string,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
  decimals0: number,
  decimals1: number
) {
  const L = Number(liquidity)
  if (L === 0 || !Number.isFinite(L)) {
    return { amount0: 0, amount1: 0 }
  }

  const sqrtP = Math.pow(1.0001, currentTick / 2)
  const sqrtPL = Math.pow(1.0001, tickLower / 2)
  const sqrtPU = Math.pow(1.0001, tickUpper / 2)

  let a0_raw = 0
  let a1_raw = 0

  if (currentTick <= tickLower) {
    // Below range: entirely in token0
    a0_raw = L * (sqrtPU - sqrtPL) / (sqrtPL * sqrtPU)
  } else if (currentTick >= tickUpper) {
    // Above range: entirely in token1
    a1_raw = L * (sqrtPU - sqrtPL)
  } else {
    // In range: mixed
    a0_raw = L * (sqrtPU - sqrtP) / (sqrtP * sqrtPU)
    a1_raw = L * (sqrtP - sqrtPL)
  }

  const amount0 = a0_raw / Math.pow(10, decimals0)
  const amount1 = a1_raw / Math.pow(10, decimals1)

  return { amount0, amount1 }
}

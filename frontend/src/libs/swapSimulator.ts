import BN from "bn.js";
import { BN_ZERO, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64 } from "./constants";
import { LiquidityMathUtil } from "./liquidityMath";
import { PoolUtil, PoolState, TickArrayState } from "./pool";
import { SwapMathUtil, SwapState } from "./swapMath";
import { TickArrayUtil, TickUtil } from "./tickArrayUtil";

export interface SwapSimulationResult {
  allTrade: boolean;
  amountSpecifiedRemaining: BN;
  amountCalculated: BN;
  feeAmount: BN;
  sqrtPriceX64: BN;
  liquidity: BN;
  tickCurrent: number;
}

export function swapInternal({
  poolInfo,
  tickArrays,
  amountSpecified,
  sqrtPriceLimitX64,
  zeroForOne,
  isBaseInput,
  feeRate,
}: {
  poolInfo: PoolState;
  tickArrays: TickArrayState[];
  amountSpecified: BN;
  sqrtPriceLimitX64: BN;
  zeroForOne: boolean;
  isBaseInput: boolean;
  feeRate: number;
}): SwapSimulationResult {
  if (sqrtPriceLimitX64.isZero()) {
    sqrtPriceLimitX64 = zeroForOne ? new BN(MIN_SQRT_PRICE_X64).addn(1) : new BN(MAX_SQRT_PRICE_X64).subn(1);
  }

  let tickArrayListIndex = 0;

  if (tickArrays.length === 0) {
    return {
      allTrade: false,
      amountSpecifiedRemaining: amountSpecified,
      amountCalculated: BN_ZERO,
      feeAmount: BN_ZERO,
      sqrtPriceX64: poolInfo.sqrtPriceX64,
      liquidity: poolInfo.liquidity,
      tickCurrent: poolInfo.tickCurrent,
    };
  }

  const _startTickIndex = TickArrayUtil.getTickArrayStartIndex(poolInfo.tickCurrent, poolInfo.tickSpacing);
  const { firstItckArrayContainsPoolTick: _firstItckArrayContainsPoolTick } = {
    firstItckArrayContainsPoolTick: tickArrays[tickArrayListIndex].startTickIndex === _startTickIndex,
  };
  let firstItckArrayContainsPoolTick = _firstItckArrayContainsPoolTick;



  let tickArrayCurrent = tickArrays[tickArrayListIndex];

  // We hardcode feeOnInput behavior as true based on our PoolUtil simplify
  const isFeeOnInput = PoolUtil.isFeeOnInput(poolInfo.status, zeroForOne);

  const state = SwapState.newValue({
    poolInfo,
    amountSpecified,
    zeroForOne,
    feeRate,
  });

  while (!state.amountSpecifiedRemaining.isZero() && !state.sqrtPriceX64.eq(sqrtPriceLimitX64)) {
    const nextInitializedTick = (() => {
      const tickState = TickArrayUtil.nextInitalizedTick({
        data: tickArrayCurrent,
        tickSpacing: state.tickSpacing,
        zeroForOne,
        currentTickIndex: state.tick,
      });
      if (tickState !== undefined) {
        return tickState;
      } else if (!firstItckArrayContainsPoolTick) {
        firstItckArrayContainsPoolTick = true;
        return TickArrayUtil.firstinitializedTick({ data: tickArrayCurrent, zeroForOne });
      } else {
        const nextTickArrayIndex = tickArrays[++tickArrayListIndex];
        if (nextTickArrayIndex === undefined) {
          return undefined;
        }


        tickArrayCurrent = nextTickArrayIndex;
        return TickArrayUtil.firstinitializedTick({ data: nextTickArrayIndex, zeroForOne });
      }
    })();

    if (nextInitializedTick === undefined) {
      return {
        allTrade: false,
        amountSpecifiedRemaining: state.amountSpecifiedRemaining,
        amountCalculated: state.amountCalculated,
        feeAmount: state.lpFee.add(state.fundFee).add(state.protocolFee),
        sqrtPriceX64: state.sqrtPriceX64,
        liquidity: state.liquidity,
        tickCurrent: state.tick,
      };
    }

    const targetPrice = SwapState.getTargetPriceBasedOnNextTick({
      data: state,
      tickNext: nextInitializedTick.tick,
      zeroForOne,
      sqrtPriceLimitX64,
    });

    let liquidityNext = state.liquidity;
    do {
      const totalFeeRate = SwapState.getTotalFeeRate({ data: state });
      const { isSkipped: isSkippedTickSpacing, boundedPrice } = SwapState.getSpacingBoundedPrice({
        data: state,
        targetPrice,
        zeroForOne,
      });

      const isPriceChange = !state.sqrtPriceX64.eq(boundedPrice);

      let swapComputedResult;
      if (isPriceChange) {
        swapComputedResult = SwapMathUtil.computeSwap(
          state.sqrtPriceX64,
          boundedPrice,
          state.liquidity,
          state.amountSpecifiedRemaining,
          totalFeeRate,
          isBaseInput,
          zeroForOne,
          isFeeOnInput,
        );

        SwapState.applySwapAmounts({
          state,
          amountIn: swapComputedResult.amountIn,
          amountOut: swapComputedResult.amountOut,
          feeAmount: swapComputedResult.feeAmount,
          isBaseInput,
          isFeeOnInput,
          protocolFeeRate: BN_ZERO,
          fundFeeRate: BN_ZERO,
        });
      } else {
        swapComputedResult = SwapMathUtil.newSwapComputationResult({ sqrtPriceNextX64: boundedPrice });
      }

      if (state.sqrtPriceNextX64.eq(swapComputedResult.sqrtPriceNextX64)) {
        if (
          TickUtil.hasLiquidity({ data: nextInitializedTick })
        ) {
          const liquidityNet = zeroForOne ? nextInitializedTick.liquidityNet.neg() : nextInitializedTick.liquidityNet;

          liquidityNext = LiquidityMathUtil.addDelta(state.liquidity, liquidityNet);
        }

        state.tick = zeroForOne ? state.tickNext - 1 : state.tickNext;
      } else if (!state.sqrtPriceX64.eq(swapComputedResult.sqrtPriceNextX64)) {
        state.tick = TickUtil.getTickAtSqrtPrice(swapComputedResult.sqrtPriceNextX64);
      }

      state.sqrtPriceX64 = swapComputedResult.sqrtPriceNextX64;
      SwapState.updateDynamicFeeIndex({ state, zeroForOne, isSkippedTickSpacing });
      if (state.amountSpecifiedRemaining.isZero() || state.sqrtPriceX64.eq(targetPrice)) {
        break;
      }

      // eslint-disable-next-line no-constant-condition
    } while (true);
    state.liquidity = liquidityNext;
  }

  return {
    allTrade: true,
    amountSpecifiedRemaining: BN_ZERO,
    amountCalculated: state.amountCalculated,
    feeAmount: state.lpFee.add(state.fundFee).add(state.protocolFee),
    sqrtPriceX64: state.sqrtPriceX64,
    liquidity: state.liquidity,
    tickCurrent: state.tick,
  };
}
import BN from "bn.js"
import { mulDivCeil, mulDivFloor } from "./bigNum"
import { BN_ZERO, FEE_RATE_DENOMINATOR, MAX_TICK, MIN_TICK, Q64 } from "./constants"
import { LiquidityMathUtil } from "./liquidityMath"
import { SqrtPriceMath } from "./sqrtPriceMath"
import { TickUtil } from "./tickArrayUtil"
import { PoolState } from "./pool"

export interface SwapStepResult {
  sqrtPriceNextX64: BN
  amountIn: BN
  amountOut: BN
  feeAmount: BN
}

interface SwapStateInterface {
  amountSpecifiedRemaining: BN,
  amountCalculated: BN,
  sqrtPriceX64: BN,
  tick: number,
  feeGrowthGlobalX64: BN,
  lpFee: BN,
  protocolFee: BN,
  fundFee: BN,
  liquidity: BN,
  sqrtPriceNextX64: BN,
  tickNext: number,
  baseFeeRate: number,
  tickSpacing: number,
  tickSpacingIndex: number,
}
export class SwapState {
  static newValue({ poolInfo, amountSpecified, zeroForOne, feeRate }: {
    poolInfo: PoolState,
    amountSpecified: BN,
    zeroForOne: boolean,
    feeRate: number,
  }): SwapStateInterface {
    const state: SwapStateInterface = {
      amountSpecifiedRemaining: amountSpecified,
      amountCalculated: BN_ZERO,
      sqrtPriceX64: poolInfo.sqrtPriceX64,
      tick: poolInfo.tickCurrent,
      feeGrowthGlobalX64: zeroForOne ? poolInfo.feeGrowthGlobal0X64 : poolInfo.feeGrowthGlobal1X64,
      lpFee: BN_ZERO,
      protocolFee: BN_ZERO,
      fundFee: BN_ZERO,
      liquidity: poolInfo.liquidity,
      sqrtPriceNextX64: BN_ZERO,
      tickNext: 0,
      baseFeeRate: feeRate,
      tickSpacing: poolInfo.tickSpacing,
      tickSpacingIndex: 0,
    }

    return state
  }

  static getTargetPriceBasedOnNextTick({ data, tickNext, zeroForOne, sqrtPriceLimitX64 }: {
    data: SwapStateInterface,
    tickNext: number,
    zeroForOne: boolean,
    sqrtPriceLimitX64: BN,
  }) {
    data.tickNext = tickNext
    if (data.tickNext < MIN_TICK) {
      data.tickNext = MIN_TICK
    } else if (data.tickNext > MAX_TICK) {
      data.tickNext = MAX_TICK
    }

    data.sqrtPriceNextX64 = TickUtil.getSqrtPriceAtTick(data.tickNext)

    let targetPrice: BN

    if ((zeroForOne && data.sqrtPriceNextX64.lt(sqrtPriceLimitX64)) || (!zeroForOne && data.sqrtPriceNextX64.gt(sqrtPriceLimitX64))) {
      targetPrice = sqrtPriceLimitX64
    } else {
      targetPrice = data.sqrtPriceNextX64
    }

    if (zeroForOne) {
      if (data.tick < data.tickNext) throw Error('data.tick < data.tickNext')
      if (data.sqrtPriceX64.lt(data.sqrtPriceNextX64)) throw Error('data.sqrtPriceX64.lt(data.sqrtPriceNextX64)')
      if (data.sqrtPriceX64.lt(targetPrice)) throw Error('data.sqrtPriceX64.lt(targetPrice)')
    } else {
      if (data.tickNext <= data.tick) throw Error('data.tickNext <= data.tick')
      if (data.sqrtPriceNextX64.lt(data.sqrtPriceX64)) throw Error('data.sqrtPriceNextX64.lt(data.sqrtPriceX64)')
      if (targetPrice.lt(data.sqrtPriceX64)) throw Error('targetPrice.lt(data.sqrtPriceX64)')
    }

    return targetPrice
  }

  static getTotalFeeRate({ data }: {
    data: SwapStateInterface,
  }) {
    return data.baseFeeRate
  }

  static getSpacingBoundedPrice({ targetPrice }: {
    data: SwapStateInterface,
    targetPrice: BN,
    zeroForOne: boolean
  }) {
    // Dynamic fee control removed, always skip spacing bounds
    return { isSkipped: true, boundedPrice: targetPrice }
  }

  static applySwapAmounts({ state, amountIn, amountOut, feeAmount, isBaseInput, isFeeOnInput, protocolFeeRate, fundFeeRate, }: {
    state: SwapStateInterface,
    amountIn: BN,
    amountOut: BN,
    feeAmount: BN,
    isBaseInput: boolean,
    isFeeOnInput: boolean,
    protocolFeeRate: BN,
    fundFeeRate: BN,
  }) {
    const amountInConsumed = isFeeOnInput ? amountIn.add(feeAmount) : amountIn

    if (isBaseInput) {
      state.amountSpecifiedRemaining = state.amountSpecifiedRemaining.sub(amountInConsumed)
      state.amountCalculated = state.amountCalculated.add(amountOut)
    } else {
      state.amountSpecifiedRemaining = state.amountSpecifiedRemaining.sub(amountOut)
      state.amountCalculated = state.amountCalculated.add(amountInConsumed)
    }

    this.splitFee({ state, feeAmount, protocolFeeRate, fundFeeRate })
  }

  static updateDynamicFeeIndex(_params: {
    state: SwapStateInterface,
    zeroForOne: boolean,
    isSkippedTickSpacing: boolean,
  }) {
    // No-op without dynamic fee info
  }

  static splitFee({ state, feeAmount, protocolFeeRate, fundFeeRate }: {
    state: SwapStateInterface,
    feeAmount: BN,
    protocolFeeRate: BN,
    fundFeeRate: BN
  }) {
    let remainingFee = feeAmount
    const FEE_RATE_DENOMINATOR_VALUE = 10000;
    if (protocolFeeRate.gt(BN_ZERO)) {
      const protocolFeeDelta = feeAmount.mul(protocolFeeRate).div(new BN(FEE_RATE_DENOMINATOR_VALUE))
      state.protocolFee = state.protocolFee.add(protocolFeeDelta)
      remainingFee = remainingFee.sub(protocolFeeDelta)
    }

    if (fundFeeRate.gt(BN_ZERO)) {
      const fundFeeDelta = feeAmount.mul(fundFeeRate).div(new BN(FEE_RATE_DENOMINATOR_VALUE))
      state.fundFee = state.fundFee.add(fundFeeDelta)
      remainingFee = remainingFee.sub(fundFeeDelta)
    }

    if (state.liquidity.gt(BN_ZERO)) {
      const feeGrowthGlobalX64Delta = mulDivFloor(remainingFee, Q64, state.liquidity)
      state.feeGrowthGlobalX64 = state.feeGrowthGlobalX64.add(feeGrowthGlobalX64Delta)
      state.lpFee = state.lpFee.add(remainingFee)
    }
  }

}


export class SwapMathUtil {
  static newSwapComputationResult({ sqrtPriceNextX64 }: { sqrtPriceNextX64?: BN }): SwapStepResult {
    return {
      sqrtPriceNextX64: sqrtPriceNextX64 ?? BN_ZERO,
      amountIn: BN_ZERO,
      amountOut: BN_ZERO,
      feeAmount: BN_ZERO,
    }
  }

  static calculateAmountInRange({ sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, zeroForOne, isBaseInput }: {
    sqrtPriceCurrentX64: BN,
    sqrtPriceTargetX64: BN,
    liquidity: BN,
    zeroForOne: boolean,
    isBaseInput: boolean,
  }) {
    if (isBaseInput) {
      try {
        const result = zeroForOne ? LiquidityMathUtil.getDeltaAmountAUnsigned(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, true) : LiquidityMathUtil.getDeltaAmountBUnsigned(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, true)
        return result
      } catch (e: any) {
        if (e.message === 'MaxTokenOverflow') return null
        throw e
      }
    } else {
      try {
        const result = zeroForOne ? LiquidityMathUtil.getDeltaAmountBUnsigned(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, false) : LiquidityMathUtil.getDeltaAmountAUnsigned(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, false)
        return result
      } catch (e: any) {
        if (e.message === 'MaxTokenOverflow') return null
        throw e
      }
    }
  }

  static computeSwap(
    sqrtPriceCurrentX64: BN,
    sqrtPriceTargetX64: BN,
    liquidity: BN,
    amountRemaining: BN,
    feeRate: number,
    isBaseInput: boolean,
    zeroForOne: boolean,
    isFeeOnInput: boolean
  ): SwapStepResult {
    const result = this.newSwapComputationResult({})

    if (isBaseInput) {
      const amountForPriceCalc = isFeeOnInput ? mulDivFloor(amountRemaining, new BN(FEE_RATE_DENOMINATOR - feeRate), new BN(FEE_RATE_DENOMINATOR)) : amountRemaining

      const amountIn = this.calculateAmountInRange({ sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, zeroForOne, isBaseInput })

      if (amountIn !== null) result.amountIn = amountIn

      result.sqrtPriceNextX64 = amountIn !== null && amountForPriceCalc.gte(result.amountIn) ? sqrtPriceTargetX64 : SqrtPriceMath.getNextSqrtPriceFromInput(sqrtPriceCurrentX64, liquidity, amountForPriceCalc, zeroForOne)
    } else {
      const amountForPriceCalc = isFeeOnInput
        ? amountRemaining
        : mulDivCeil(
          amountRemaining,
          new BN(FEE_RATE_DENOMINATOR),
          new BN(FEE_RATE_DENOMINATOR - feeRate)
        )

      const amountOut = this.calculateAmountInRange({ sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, zeroForOne, isBaseInput })
      if (amountOut !== null) result.amountOut = amountOut

      result.sqrtPriceNextX64 = amountOut !== null && amountForPriceCalc.gte(result.amountOut) ? sqrtPriceTargetX64 : SqrtPriceMath.getNextSqrtPriceFromOutput(sqrtPriceCurrentX64, liquidity, amountForPriceCalc, zeroForOne)
    }

    if (zeroForOne) {
      if (!result.sqrtPriceNextX64.gte(sqrtPriceTargetX64)) throw Error('!result.sqrtPriceNextX64.gte(sqrtPriceTargetX64)')
    } else {
      if (!sqrtPriceTargetX64.gte(result.sqrtPriceNextX64)) throw Error('!sqrtPriceTargetX64.gte(result.sqrtPriceNextX64)')
    }

    const max = sqrtPriceTargetX64.eq(result.sqrtPriceNextX64)

    if (zeroForOne) {
      if (!(max && isBaseInput)) {
        result.amountIn = LiquidityMathUtil.getDeltaAmountAUnsigned(result.sqrtPriceNextX64, sqrtPriceCurrentX64, liquidity, true)
      }
      if (!(max && !isBaseInput)) {
        result.amountOut = LiquidityMathUtil.getDeltaAmountBUnsigned(result.sqrtPriceNextX64, sqrtPriceCurrentX64, liquidity, false)
      }
    } else {
      if (!(max && isBaseInput)) {
        result.amountIn = LiquidityMathUtil.getDeltaAmountBUnsigned(sqrtPriceCurrentX64, result.sqrtPriceNextX64, liquidity, true)
      }
      if (!(max && !isBaseInput)) {
        result.amountOut = LiquidityMathUtil.getDeltaAmountAUnsigned(sqrtPriceCurrentX64, result.sqrtPriceNextX64, liquidity, false)
      }
    }

    if (isBaseInput) {
      if (isFeeOnInput) {
        if (!result.sqrtPriceNextX64.eq(sqrtPriceTargetX64)) {
          result.feeAmount = amountRemaining.sub(result.amountIn)
        } else {
          result.feeAmount = mulDivCeil(
            result.amountIn,
            new BN(feeRate),
            new BN(FEE_RATE_DENOMINATOR - feeRate)
          )
        }
      } else {
        result.feeAmount = mulDivCeil(result.amountOut, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
        result.amountOut = result.amountOut.sub(result.feeAmount)

        if (!max) {
          result.amountIn = amountRemaining
        }
      }
    } else {
      if (isFeeOnInput) {
        result.amountOut = BN.min(result.amountOut, amountRemaining)
        result.feeAmount = mulDivCeil(
          result.amountIn,
          new BN(feeRate),
          new BN(FEE_RATE_DENOMINATOR - feeRate)
        )
      } else {
        result.feeAmount = mulDivCeil(result.amountOut, new BN(feeRate), new BN(FEE_RATE_DENOMINATOR))
        const netOutput = result.amountOut.sub(result.feeAmount)

        if (netOutput.gt(amountRemaining)) {
          result.feeAmount = result.amountOut.sub(amountRemaining)
          result.amountOut = amountRemaining
        } else {
          result.amountOut = netOutput
        }
      }
    }

    return result
  }
}
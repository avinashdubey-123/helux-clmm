import BN from "bn.js"
import { mostSignificantBit, mulDivFloor } from "./bigNum"
import {
  BIT_PRECISION,
  LOG_B_2_X32,
  LOG_B_P_ERR_MARGIN_LOWER_X64,
  LOG_B_P_ERR_MARGIN_UPPER_X64,
  MAX_SQRT_PRICE_X64,
  MAX_TICK,
  MIN_SQRT_PRICE_X64,
  MIN_TICK,
  Q64,
  TICK_ARRAY_SIZE,
  TICK_TO_SQRT_PRICE_FACTORS,
} from "./constants"
import { TickArrayState, TickState } from "./pool"

export class TickArrayUtil {
  static firstinitializedTick({
    data,
    zeroForOne,
  }: {
    data: TickArrayState;
    zeroForOne: boolean;
  }) {
    if (zeroForOne) {
      for (let i = data.ticks.length - 1; i >= 0; i--) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) return data.ticks[i];
      }
    } else {
      for (let i = 0; i < data.ticks.length; i++) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) return data.ticks[i];
      }
    }
  }

  static nextInitalizedTick({
    data,
    currentTickIndex,
    tickSpacing,
    zeroForOne,
  }: {
    data: TickArrayState;
    currentTickIndex: number;
    tickSpacing: number;
    zeroForOne: boolean;
  }) {
    const currentTickArrayStartIndex = this.getTickArrayStartIndex(currentTickIndex, tickSpacing);
    if (currentTickArrayStartIndex !== data.startTickIndex) return undefined;
    const offsetInArray = Math.floor((currentTickIndex - data.startTickIndex) / tickSpacing);

    if (zeroForOne) {
      for (let i = offsetInArray; i >= 0; i--) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) {
          return data.ticks[i];
        }
      }
    } else {
      for (let i = offsetInArray + 1; i < TICK_ARRAY_SIZE; i++) {
        if (TickUtil.isInitialized({ data: data.ticks[i] })) {
          return data.ticks[i];
        }
      }
    }
    return undefined;
  }

  static getTickArrayStartIndex(tickIndex: number, tickSpacing: number) {
    const ticksInArray = this.tickCount(tickSpacing);
    const start = Math.floor(tickIndex / ticksInArray);

    return start * ticksInArray;
  }

  static tickCount(tickSpacing: number) {
    return TICK_ARRAY_SIZE * tickSpacing;
  }
}

export class TickUtil {
  static isInitialized({ data }: { data: TickState }): boolean {
    return this.hasLiquidity({ data });
  }

  static hasLiquidity({ data }: { data: TickState }): boolean {
    return !data.liquidityGross.isZero();
  }

  static isValidTick(tick: number): boolean {
    return tick >= MIN_TICK && tick <= MAX_TICK;
  }

  static checkTick(tick: number): void {
    if (!this.isValidTick(tick)) {
      throw new Error(`Tick ${tick} is out of range [${MIN_TICK}, ${MAX_TICK}]`);
    }
  }

  static getSqrtPriceAtTick(tick: number): BN {
    this.checkTick(tick);

    const absTick = Math.abs(tick);

    let ratio = Q64.clone();

    for (const { bit, factor } of TICK_TO_SQRT_PRICE_FACTORS) {
      if ((absTick & (1 << bit)) !== 0) {
        ratio = mulDivFloor(ratio, factor, Q64);
      }
    }

    if (tick > 0) {
      ratio = mulDivFloor(Q64, Q64, ratio);
    }

    return ratio;
  }

  static getTickAtSqrtPrice(sqrtPriceX64: BN): number {
    if (!(sqrtPriceX64.gte(MIN_SQRT_PRICE_X64) && sqrtPriceX64.lte(MAX_SQRT_PRICE_X64))) throw Error("SqrtPriceX64");

    const msb = mostSignificantBit(sqrtPriceX64);

    const msbMinus64 = msb - 64;
    let log2pIntegerX32: BN;
    if (msbMinus64 >= 0) {
      log2pIntegerX32 = new BN(msbMinus64).shln(32);
    } else {
      log2pIntegerX32 = new BN(-msbMinus64).shln(32).neg();
    }

    let r: BN;
    if (msb >= 64) {
      r = sqrtPriceX64.shrn(msb - 63);
    } else {
      r = sqrtPriceX64.shln(63 - msb);
    }

    let log2pFractionX64 = new BN(0);
    let bit = new BN(1).shln(63);

    for (let precision = 0; precision < BIT_PRECISION && !bit.isZero(); precision++) {
      r = r.mul(r);

      const isRMoreThanTwo = r.shrn(127).toNumber();

      r = r.shrn(63 + isRMoreThanTwo);

      if (isRMoreThanTwo) {
        log2pFractionX64 = log2pFractionX64.add(bit);
      }

      bit = bit.shrn(1);
    }

    const log2pFractionX32 = log2pFractionX64.shrn(32);
    const log2pX32 = log2pIntegerX32.add(log2pFractionX32);

    const logSqrt10001X64 = log2pX32.mul(LOG_B_2_X32);

    const tickLowBN = logSqrt10001X64.sub(LOG_B_P_ERR_MARGIN_LOWER_X64);
    const tickHighBN = logSqrt10001X64.add(LOG_B_P_ERR_MARGIN_UPPER_X64);

    const tickLow = this.signedShrn64(tickLowBN);
    const tickHigh = this.signedShrn64(tickHighBN);

    if (tickLow === tickHigh) {
      return tickLow;
    }

    const sqrtPriceAtTickHigh = TickUtil.getSqrtPriceAtTick(tickHigh);
    if (sqrtPriceAtTickHigh.lte(sqrtPriceX64)) {
      return tickHigh;
    }

    return tickLow;
  }

  private static signedShrn64(bn: BN): number {
    if (bn.isNeg()) {
      const Q64 = new BN(1).shln(64);
      const result = bn.div(Q64);
      if (!bn.mod(Q64).isZero() && bn.isNeg()) {
        return result.subn(1).toNumber();
      }
      return result.toNumber();
    } else {
      return bn.shrn(64).toNumber();
    }
  }

  static toTickIndex(tick: number, tickSpacing: number) {
    if (tick >= 0) {
      return tick - (tick % tickSpacing);
    }
    return tick - (tick % tickSpacing) - (tick % tickSpacing !== 0 ? tickSpacing : 0);
  }
}
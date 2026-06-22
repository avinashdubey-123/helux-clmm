import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface PoolState {
  ammConfig: PublicKey;
  owner: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  observationKey: PublicKey;
  mintDecimals0: number;
  mintDecimals1: number;
  tickSpacing: number;
  liquidity: BN;
  sqrtPriceX64: BN;
  tickCurrent: number;
  feeGrowthGlobal0X64: BN;
  feeGrowthGlobal1X64: BN;
  protocolFeesToken0: BN;
  protocolFeesToken1: BN;
  swapInAmountToken0: BN;
  swapOutAmountToken1: BN;
  swapInAmountToken1: BN;
  swapOutAmountToken0: BN;
  status: number;
  tickArrayBitmap: BN[];
}

export interface TickState {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutside0X64: BN;
  feeGrowthOutside1X64: BN;
}

export interface TickArrayState {
  poolId: PublicKey;
  startTickIndex: number;
  ticks: TickState[];
  initializedTickCount: number;
}

export interface TickArrayBitmapExtension {
  poolId: PublicKey;
  positiveTickArrayBitmap: number[][];
  negativeTickArrayBitmap: number[][];
}

export class PoolUtil {
  static isFeeOnInput(_feeOn: number, _zeroForOne: boolean): boolean {
    return true; // Simple default since feeOn doesn't exist in our PoolState
  }
}

export class PoolFee {
  static tickSpacingIndexFromTick(tickIndex: number, tickSpacing: number): number {
    if (tickIndex % tickSpacing == 0 || tickIndex >= 0) {
      return Math.floor(tickIndex / tickSpacing);
    } else {
      return Math.floor(tickIndex / tickSpacing) - 1;
    }
  }
}
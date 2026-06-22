import BN from 'bn.js';
import { divRoundingUp } from './bigNum';
import { Q64 } from './constants';

export class SqrtPriceMath {
  static getNextSqrtPriceFromAmount0RoundingUp(
    sqrtPX64: BN,
    liquidity: BN,
    amount: BN,
    add: boolean
  ): BN {
    if (amount.isZero()) return sqrtPX64;

    const numerator1 = liquidity.shln(64);
    if (add) {
      const product = amount.mul(sqrtPX64);
      if (product.div(amount).eq(sqrtPX64)) {
        const denominator = numerator1.add(product);
        if (denominator.gte(numerator1)) {
          return divRoundingUp(numerator1.mul(sqrtPX64), denominator);
        }
      }
      return divRoundingUp(numerator1, numerator1.div(sqrtPX64).add(amount));
    } else {
      const product = amount.mul(sqrtPX64);
      if (product.div(amount).eq(sqrtPX64)) {
        const denominator = numerator1.sub(product);
        return divRoundingUp(numerator1.mul(sqrtPX64), denominator);
      }
      throw new Error('Denominator underflow');
    }
  }

  static getNextSqrtPriceFromAmount1RoundingDown(
    sqrtPX64: BN,
    liquidity: BN,
    amount: BN,
    add: boolean
  ): BN {
    if (add) {
      const quotient = amount.lte(new BN('18446744073709551615' /* U64_MAX */))
        ? amount.shln(64).div(liquidity)
        : amount.mul(Q64).div(liquidity);
      return sqrtPX64.add(quotient);
    } else {
      const quotient = divRoundingUp(amount.mul(Q64), liquidity);
      return sqrtPX64.sub(quotient);
    }
  }

  static getNextSqrtPriceFromInput(
    sqrtPX64: BN,
    liquidity: BN,
    amountIn: BN,
    zeroForOne: boolean
  ): BN {
    if (sqrtPX64.isZero() || liquidity.isZero() || amountIn.isZero()) return sqrtPX64;

    if (zeroForOne) {
      return this.getNextSqrtPriceFromAmount0RoundingUp(sqrtPX64, liquidity, amountIn, true);
    } else {
      return this.getNextSqrtPriceFromAmount1RoundingDown(sqrtPX64, liquidity, amountIn, true);
    }
  }

  static getNextSqrtPriceFromOutput(
    sqrtPX64: BN,
    liquidity: BN,
    amountOut: BN,
    zeroForOne: boolean
  ): BN {
    if (sqrtPX64.isZero() || liquidity.isZero() || amountOut.isZero()) return sqrtPX64;

    if (zeroForOne) {
      return this.getNextSqrtPriceFromAmount1RoundingDown(sqrtPX64, liquidity, amountOut, false);
    } else {
      return this.getNextSqrtPriceFromAmount0RoundingUp(sqrtPX64, liquidity, amountOut, false);
    }
  }
}

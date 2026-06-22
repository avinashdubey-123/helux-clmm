import BN from 'bn.js';

export function mulDivFloor(a: BN, b: BN, denominator: BN): BN {
  return a.mul(b).div(denominator);
}

export function mulDivCeil(a: BN, b: BN, denominator: BN): BN {
  const product = a.mul(b);
  let result = product.div(denominator);
  if (!product.mod(denominator).isZero()) {
    result = result.addn(1);
  }
  return result;
}

export function divRoundingUp(a: BN, denominator: BN): BN {
  let result = a.div(denominator);
  if (!a.mod(denominator).isZero()) {
    result = result.addn(1);
  }
  return result;
}

export function mostSignificantBit(x: BN): number {
  if (x.isZero()) {
    throw new Error('ZERO');
  }
  return x.bitLength() - 1;
}



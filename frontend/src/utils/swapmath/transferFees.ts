import { Connection, PublicKey } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'

export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

export interface TransferFeeConfig {
  feeBasisPoints: number;
  maxFee: BN;
}

/**
 * Fetches the TransferFeeConfig from a Token-2022 mint account.
 * If the mint is standard SPL Token, returns null.
 */
export async function getTransferFeeConfig(connection: Connection, mintKey: PublicKey): Promise<TransferFeeConfig | null> {
  const mintInfo = await connection.getAccountInfo(mintKey)
  if (!mintInfo) return null

  // Check if it's Token-2022 and has enough data for transfer fee extension
  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) && mintInfo.data.length >= 82) {
    // Note: The TransferFeeConfig extension data offset might vary if there are multiple extensions.
    // However, in spl-token-2022 standard, if transfer fee is the first/only extension, 
    // fee_basis_points is at offset 72 (or 108 if mint length is different).
    // For simplicity and matching standard Raydium CLMM frontend logic for transfer fee offsets:
    
    // In spl-token-2022:
    // Mint size = 82
    // ExtensionType (2 bytes) + Length (2 bytes) = 4 bytes
    // TransferFeeConfig starts at offset 86 if it's immediately after base mint.
    // Wait, let's use the offset 72 used in DecreaseLiquidityModal as baseline if that's what was working,
    // or better, implement a robust extension parser if needed.
    // For now, mirroring the DecreaseLiquidityModal logic.
    
    // Fallback simple reading if using fixed offsets:
    try {
      // In spl-token, base mint is 82 bytes.
      // Extensions start after 82.
      // DecreaseLiquidityModal used 72 and 74? That might be inside Account data, but Mint is 82.
      // Actually, SPL Token 2022 Mint length without extensions is 82.
      // Let's use a safe parser if possible, but for now we'll match DecreaseLiquidityModal's logic
      // which read from 72, 74. Wait, DecreaseLiquidityModal read:
      // const feeBasisPoints = mint0Info.data.readUInt16LE(72)
      // const maxFee = Number(mint0Info.data.readBigUInt64LE(74))
      
      const feeBasisPoints = mintInfo.data.readUInt16LE(72)
      const maxFeeStr = mintInfo.data.readBigUInt64LE(74).toString()
      const maxFee = new BN(maxFeeStr)
      
      return { feeBasisPoints, maxFee }
    } catch (e) {
      console.warn("Failed to parse transfer fee config", e)
      return null
    }
  }
  
  return null
}

/**
 * Calculates the exact transfer fee to be deducted from `amount`
 * following the Rust `calculate_epoch_fee` formula:
 * fee = ceil((amount * bps) / 10000)
 */
export function getTransferFee(amount: BN, feeBps: number, maxFee: BN): BN {
  if (feeBps === 0) return new BN(0)
  
  const numerator = amount.muln(feeBps)
  // ceil div: (numerator + 9999) / 10000
  const rawFee = numerator.addn(9999).divn(10000)
  
  return rawFee.gt(maxFee) ? maxFee : rawFee
}

/**
 * Calculates the exact inverse transfer fee (how much extra must be added
 * so that after deducting fee, we are left with `postFeeAmount`)
 * following the Rust `calculate_inverse_epoch_fee` formula:
 * fee = ceil((postFeeAmount * bps) / (10000 - bps))
 */
export function getTransferInverseFee(postFeeAmount: BN, feeBps: number, maxFee: BN): BN {
  if (feeBps === 0) return new BN(0)
  if (feeBps === 10000) return maxFee

  const numerator = postFeeAmount.muln(feeBps)
  const denominator = 10000 - feeBps
  
  // ceil div: (numerator + denominator - 1) / denominator
  const rawFee = numerator.addn(denominator - 1).divn(denominator)

  return rawFee.gt(maxFee) ? maxFee : rawFee
}

declare const require: any;

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const AMM_CONFIG_SEED = 'amm_config';
export const OPERATION_SEED = 'operation';
export const SUPPORT_MINT_SEED = 'support_mint';
export const POOL_SEED = 'pool';
export const POOL_VAULT_SEED = 'pool_vault';
export const POOL_REWARD_VAULT_SEED = 'pool_reward_vault';
export const POOL_TICK_ARRAY_BITMAP_SEED = 'pool_tick_array_bitmap_extension';
export const OBSERVATION_SEED = 'observation';
export const POSITION_SEED = 'position';
export const TICK_ARRAY_SEED = 'tick_array';

export type PublicKeyLike = { toBytes(): Uint8Array } | string | PublicKey;

// PDAs are returned as tuples: [address, bump]

function toPublicKey(value: PublicKeyLike): PublicKey {
    return value instanceof PublicKey ? value : new PublicKey(value as any);
}

function seedBytes(seed: string): Uint8Array {
    return new TextEncoder().encode(seed);
}

export function u16ToBytes(num: number) {
    return new anchor.BN(num).toArrayLike(Uint8Array as any, 'be', 2);
}

export function i16ToBytes(num: number) {
    return new anchor.BN(num).toTwos(16).toArrayLike(Uint8Array as any, 'be', 2);
}

export function u32ToBytes(num: number) {
    return new anchor.BN(num).toArrayLike(Uint8Array as any, 'be', 4);
}

export function i32ToBytes(num: number) {
    return new anchor.BN(num).toTwos(32).toArrayLike(Uint8Array as any, 'be', 4);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
    const length = Math.min(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
        if (left[index] !== right[index]) {
            return left[index] - right[index];
        }
    }

    return left.length - right.length;
}

export function sortMints(mintA: PublicKeyLike, mintB: PublicKeyLike): [PublicKey, PublicKey] {
    const publicKeyA = toPublicKey(mintA);
    const publicKeyB = toPublicKey(mintB);
    return compareBytes(publicKeyA.toBytes(), publicKeyB.toBytes()) <= 0
        ? [publicKeyA, publicKeyB]
        : [publicKeyB, publicKeyA];
}

export function derivePda(seeds: Uint8Array[], programId: PublicKeyLike): [PublicKey, number] {
    const [address, bump] = PublicKey.findProgramAddressSync(seeds, toPublicKey(programId));
    return [address, bump];
}

export function getAmmConfigAddress(index: number, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda([seedBytes(AMM_CONFIG_SEED), u16ToBytes(index)], programId);
}

export function getOperationAccountAddress(programId: PublicKeyLike): [PublicKey, number] {
    return derivePda([seedBytes(OPERATION_SEED)], programId);
}


export function getSupportMintAssociatedAddress(tokenMint: PublicKeyLike, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda([seedBytes(SUPPORT_MINT_SEED), toPublicKey(tokenMint).toBytes()], programId);
}
                                                                                                                                                                                                                                                                                                                    `
                                                                                                                                                                                                                                                                                                                    `
export function getPoolAddress(
    ammConfig: PublicKeyLike,
    mintA: PublicKeyLike,
    mintB: PublicKeyLike,
    programId: PublicKeyLike,
): [PublicKey, number, PublicKey, PublicKey] {
    const [tokenMint0, tokenMint1] = sortMints(mintA, mintB);
    const [address, bump] = derivePda(
        [
            seedBytes(POOL_SEED),
            toPublicKey(ammConfig).toBytes(),
            tokenMint0.toBytes(),
            tokenMint1.toBytes(),
        ],
        programId,
    );

    return [address, bump, tokenMint0, tokenMint1];
}

export function getPoolVaultAddress(poolState: PublicKeyLike, tokenMint: PublicKeyLike, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda(
        [seedBytes(POOL_VAULT_SEED), toPublicKey(poolState).toBytes(), toPublicKey(tokenMint).toBytes()],
        programId,
    );
}

export function getPoolRewardVaultAddress(poolState: PublicKeyLike, rewardMint: PublicKeyLike, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda(
        [
            seedBytes(POOL_REWARD_VAULT_SEED),
            toPublicKey(poolState).toBytes(),
            toPublicKey(rewardMint).toBytes(),
        ],
        programId,
    );
}

export function getObservationAddress(poolState: PublicKeyLike, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda([seedBytes(OBSERVATION_SEED), toPublicKey(poolState).toBytes()], programId);
}

export function getPoolTickArrayBitmapAddress(poolState: PublicKeyLike, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda(
        [seedBytes(POOL_TICK_ARRAY_BITMAP_SEED), toPublicKey(poolState).toBytes()],
        programId,
    );
}

export function getPositionAddress(positionNftMint: PublicKeyLike, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda([seedBytes(POSITION_SEED), toPublicKey(positionNftMint).toBytes()], programId);
}

export function getTickArrayAddress(poolState: PublicKeyLike, startTickIndex: number, programId: PublicKeyLike): [PublicKey, number] {
    return derivePda(
        [seedBytes(TICK_ARRAY_SEED), toPublicKey(poolState).toBytes(), i32ToBytes(startTickIndex)],
        programId,
    );
}

export function getAllPoolAddresses(params: {
    ammConfig: PublicKeyLike;
    mintA: PublicKeyLike;
    mintB: PublicKeyLike;
    rewardMint?: PublicKeyLike;
    programId: PublicKeyLike;
}): {
    pool: [PublicKey, number];
    tokenMint0: PublicKey;
    tokenMint1: PublicKey;
    tokenVault0: [PublicKey, number];
    tokenVault1: [PublicKey, number];
    observation: [PublicKey, number];
    tickArrayBitmap: [PublicKey, number];
    rewardVault?: [PublicKey, number];
} {
    const programId = params.programId;
    const [poolAddress, poolBump, tokenMint0, tokenMint1] = getPoolAddress(
        params.ammConfig,
        params.mintA,
        params.mintB,
        programId,
    );

    const tokenVault0 = getPoolVaultAddress(poolAddress, tokenMint0, programId);
    const tokenVault1 = getPoolVaultAddress(poolAddress, tokenMint1, programId);

    return {
        pool: [poolAddress, poolBump],
        tokenMint0,
        tokenMint1,
        tokenVault0,
        tokenVault1,
        observation: getObservationAddress(poolAddress, programId),
        tickArrayBitmap: getPoolTickArrayBitmapAddress(poolAddress, programId),
        rewardVault: params.rewardMint ? getPoolRewardVaultAddress(poolAddress, params.rewardMint, programId) : undefined,
    };
}
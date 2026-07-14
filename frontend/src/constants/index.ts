import { PublicKey } from '@solana/web3.js';

export const DEVNET_PROGRAM_ID_BASE58 = 'HxfQdbYzW1fgh4NiC4NFo7A13Nf5Nch3D4DNNnwYYnrh';
export const LOCALNET_PROGRAM_ID_BASE58 = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

export const DEVNET_PROGRAM_ID = new PublicKey(DEVNET_PROGRAM_ID_BASE58);
export const LOCALNET_PROGRAM_ID = new PublicKey(LOCALNET_PROGRAM_ID_BASE58);

export const getProgramIdForCluster = (endpoint?: string): PublicKey => {
    if (endpoint && (endpoint.includes('localhost') || endpoint.includes('127.0.0.1'))) {
        return LOCALNET_PROGRAM_ID;
    }
    return DEVNET_PROGRAM_ID;
};

export const getProgramIdBase58ForCluster = (endpoint?: string): string => {
    if (endpoint && (endpoint.includes('localhost') || endpoint.includes('127.0.0.1'))) {
        return LOCALNET_PROGRAM_ID_BASE58;
    }
    return DEVNET_PROGRAM_ID_BASE58;
};

import { useMemo } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import idlJson from '../../idl/amm_v3.json'

import { getProgramIdBase58ForCluster } from '../constants'

export default function useProgram(): Program | null {
    const { connection } = useConnection()
    const wallet = useWallet()

    const anchorWallet = useMemo(() => {
        if (wallet && wallet.connected && wallet.publicKey) {
            return {
                publicKey: wallet.publicKey,
                signTransaction: wallet.signTransaction?.bind(wallet),
                signAllTransactions: wallet.signAllTransactions?.bind(wallet),
            }
        }

        return {
            publicKey: PublicKey.default,
            signTransaction: async <T>(transaction: T) => transaction,
            signAllTransactions: async <T>(transactions: T) => transactions,
        }
    }, [wallet])

    const provider = useMemo(() => {
        if (!anchorWallet) return null;
        return new AnchorProvider(connection, anchorWallet as any, AnchorProvider.defaultOptions());
    }, [connection, anchorWallet]);

    const program = useMemo(() => {
        if (!provider) return null

        try {
            const idl = JSON.parse(JSON.stringify(idlJson)) as Idl & { address?: string }
            const endpoint = connection.rpcEndpoint || (window as any).solana?.rpcEndpoint || ''
            idl.address = getProgramIdBase58ForCluster(endpoint)
            return new Program(idl, provider)
        } catch (err) {
            console.error('useProgram: failed to create Program', err)
            return null
        }
    }, [provider])

    return program
}
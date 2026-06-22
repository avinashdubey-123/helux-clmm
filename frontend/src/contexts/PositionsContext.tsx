import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import useProgram from '../utils/useProgram'
import { getPositionAddress } from '../utils/pda'
import { PositionRowData } from '../hooks/usePositions'

interface PositionsContextType {
  positions: PositionRowData[]
  loadingPositions: boolean
  positionsError: string | null
  refreshPositions: () => void
}

const PositionsContext = createContext<PositionsContextType>({
  positions: [],
  loadingPositions: false,
  positionsError: null,
  refreshPositions: () => {}
})

export const usePositionsContext = () => useContext(PositionsContext)

export const PositionsProvider = ({ children }: { children: ReactNode }) => {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const program = useProgram()
  
  const [positions, setPositions] = useState<PositionRowData[]>(() => {
    try {
      const cachedWallet = sessionStorage.getItem('positionsCacheWallet')
      const cached = sessionStorage.getItem('positionsCache')
      
      if (cached && cachedWallet) {
        // If we have a public key, only load cache if it matches
        if (publicKey && cachedWallet !== publicKey.toBase58()) {
          return []
        }
        return JSON.parse(cached)
      }
    } catch (e) {
      console.warn("Failed to parse cached positions", e)
    }
    return []
  })
  const [loadingPositions, setLoadingPositions] = useState(false)
  const [positionsError, setPositionsError] = useState<string | null>(null)
  const [refreshCounter, setRefreshCounter] = useState(0)

  const refreshPositions = useCallback(() => {
    setRefreshCounter(c => c + 1)
  }, [])

  useEffect(() => {
    let mounted = true
    
    const loadPositions = async () => {
      if (!publicKey || !program) {
        if (mounted) {
          setPositions([])
          setLoadingPositions(false)
        }
        return
      }

      try {
        // Only show loading spinner if we don't have cached data to show immediately
        if (mounted && positions.length === 0) setLoadingPositions(true)

        // 1. Fetch all token accounts owned by wallet
        const parsedTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_PROGRAM_ID,
        })

        // 2. Filter for potential NFT mints (balance 1, decimals 0)
        const possibleMints = parsedTokenAccounts.value
          .filter(
            (account) =>
              account.account.data.parsed.info.tokenAmount.uiAmount === 1 &&
              account.account.data.parsed.info.tokenAmount.decimals === 0
          )
          .map((account) => new PublicKey(account.account.data.parsed.info.mint))

        if (possibleMints.length === 0) {
          if (mounted) {
            setPositions([])
            setLoadingPositions(false)
          }
          return
        }

        // 3. Derive PersonalPosition PDAs
        const pdas = possibleMints.map(mint => {
          const [address] = getPositionAddress(mint, program.programId)
          return address
        })

        // 4. Fetch multiple accounts to find valid positions
        // @ts-ignore
        const positionAccounts = await program.account.personalPositionState.fetchMultiple(pdas).catch(() => null)
        
        if (!positionAccounts) {
          if (mounted) setLoadingPositions(false)
          return
        }

        const validPositions: PositionRowData[] = []
        for (let i = 0; i < positionAccounts.length; i++) {
          const account = positionAccounts[i]
          if (account) {
            validPositions.push({
              positionPda: pdas[i].toBase58(),
              nftMint: possibleMints[i].toBase58(),
              // @ts-ignore
              poolId: account.poolId.toBase58(),
              // @ts-ignore
              tickLower: account.tickLowerIndex,
              // @ts-ignore
              tickUpper: account.tickUpperIndex,
              // @ts-ignore
              liquidity: account.liquidity.toString(),
              // @ts-ignore
              feeGrowthInside0Last: account.feeGrowthInside0LastX64.toString(),
              // @ts-ignore
              feeGrowthInside1Last: account.feeGrowthInside1LastX64.toString(),
            })
          }
        }

        if (mounted) {
          setPositions(validPositions)
          setPositionsError(null)
          
          try {
            // Include wallet pubkey in cache to ensure we don't bleed cache between wallets
            sessionStorage.setItem('positionsCache', JSON.stringify(validPositions))
            sessionStorage.setItem('positionsCacheWallet', publicKey.toBase58())
          } catch (e) {
            console.warn("Failed to cache positions", e)
          }
        }
      } catch (err: any) {
        console.error("Failed to load positions:", err)
        if (mounted) setPositionsError(err.message ?? "Failed to load positions")
      } finally {
        if (mounted) setLoadingPositions(false)
      }
    }

    loadPositions()

    return () => { mounted = false }
  }, [connection, publicKey, program, refreshCounter])

  return (
    <PositionsContext.Provider value={{ positions, loadingPositions, positionsError, refreshPositions }}>
      {children}
    </PositionsContext.Provider>
  )
}

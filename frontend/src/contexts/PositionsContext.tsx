/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import useProgram from "../utils/useProgram";
import { getPositionAddress, getTickArrayAddress } from "../utils/pda";
import { PositionRowData } from "../hooks/usePositions";
import { callWithRetry } from "../utils/batchFetch";

interface PositionsContextType {
  positions: PositionRowData[];
  loadingPositions: boolean;
  positionsError: string | null;
  refreshPositions: () => void;
}

const PositionsContext = createContext<PositionsContextType>({
  positions: [],
  loadingPositions: false,
  positionsError: null,
  refreshPositions: () => {},
});

export const usePositionsContext = () => useContext(PositionsContext);

export const PositionsProvider = ({ children }: { children: ReactNode }) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useProgram();

  const [positions, setPositions] = useState<PositionRowData[]>(() => {
    try {
      const cachedWallet = sessionStorage.getItem("positionsCacheWallet");
      const cached = sessionStorage.getItem("positionsCache");

      if (cached && cachedWallet) {
        // If we have a public key, only load cache if it matches
        if (publicKey && cachedWallet !== publicKey.toBase58()) {
          return [];
        }
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn("Failed to parse cached positions", e);
    }
    return [];
  });
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refreshPositions = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadPositions = async () => {
      if (!publicKey || !program) {
        if (mounted) {
          setPositions([]);
          setLoadingPositions(false);
        }
        return;
      }

      try {
        // Only show loading spinner if we don't have cached data to show immediately
        if (mounted && positions.length === 0) setLoadingPositions(true);

        // 1. Fetch all token accounts owned by wallet
        const parsedTokenAccounts = await callWithRetry(() =>
          connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: TOKEN_PROGRAM_ID,
          }),
        );

        // 2. Filter for potential NFT mints (balance 1, decimals 0)
        const possibleMints = parsedTokenAccounts.value
          .filter(
            (account) =>
              account.account.data.parsed.info.tokenAmount.uiAmount === 1 &&
              account.account.data.parsed.info.tokenAmount.decimals === 0,
          )
          .map(
            (account) => new PublicKey(account.account.data.parsed.info.mint),
          );

        if (possibleMints.length === 0) {
          if (mounted) {
            setPositions([]);
            setLoadingPositions(false);
          }
          return;
        }

        // 3. Derive PersonalPosition PDAs
        const pdas = possibleMints.map((mint) => {
          const [address] = getPositionAddress(mint, program.programId);
          return address;
        });

        console.log(
          `[PositionsContext] Fetching ${pdas.length} position accounts`,
          {
            addresses: pdas.map((pk) => pk.toBase58()),
            wallet: publicKey.toBase58(),
          },
        );

        // 4. Fetch multiple accounts to find valid positions
        // @ts-ignore
        const positionAccounts = (await callWithRetry(() => program.account.personalPositionState
          .fetchMultiple(pdas))
          .catch((err: any) => {
            console.error(
              `[PositionsContext] Failed to fetch positions batch`,
              {
                error: err instanceof Error ? err.message : String(err),
                count: pdas.length,
                addresses: pdas.map((pk) => pk.toBase58()),
              },
            );
            return null;
          })) as any[] | null;

        if (!positionAccounts) {
          console.warn(
            "[PositionsContext] No position accounts returned, trying individual fetches",
          );
          // Fallback: fetch one by one
          const validPositions: PositionRowData[] = [];
          for (let i = 0; i < pdas.length; i++) {
            try {
              // @ts-ignore
              const account = await program.account.personalPositionState.fetch(
                pdas[i],
              );
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
                feeGrowthInside0Last:
                  account.feeGrowthInside0LastX64.toString(),
                // @ts-ignore
                feeGrowthInside1Last:
                  account.feeGrowthInside1LastX64.toString(),
                // @ts-ignore
                tokenFeesOwed0: account.tokenFeesOwed0.toString(),
                // @ts-ignore
                tokenFeesOwed1: account.tokenFeesOwed1.toString(),
                // @ts-ignore
                rewardInfos: account.rewardInfos.map((ri: any) => ({
                  growthInsideLastX64: ri.growthInsideLastX64.toString(),
                  rewardAmountOwed: ri.rewardAmountOwed.toString(),
                })),
              });
            } catch (err) {
              console.warn(
                `[PositionsContext] Failed to fetch position ${pdas[i].toBase58()}`,
                err,
              );
            }
          }

          if (mounted) {
            setPositions(validPositions);
            setPositionsError(null);
          }
          if (mounted) setLoadingPositions(false);
          return;
        }

        const validPositions: PositionRowData[] = [];
        const successCount = positionAccounts.filter(
          (acc: unknown): acc is NonNullable<unknown> => acc !== null,
        ).length;
        console.log(
          `[PositionsContext] Successfully fetched ${successCount}/${positionAccounts.length} positions`,
        );

        for (let i = 0; i < positionAccounts.length; i++) {
          const account = positionAccounts[i];
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
              // @ts-ignore
              tokenFeesOwed0: account.tokenFeesOwed0.toString(),
              // @ts-ignore
              tokenFeesOwed1: account.tokenFeesOwed1.toString(),
              // @ts-ignore
              rewardInfos: account.rewardInfos.map((ri: any) => ({
                growthInsideLastX64: ri.growthInsideLastX64.toString(),
                rewardAmountOwed: ri.rewardAmountOwed.toString(),
              })),
            });
          }
        }

        // --- NEW: Batch fetch TickArrays to get rewardGrowthsOutsideX64 ---
        if (validPositions.length > 0) {
          try {
            const uniquePoolIds = [...new Set(validPositions.map(p => new PublicKey(p.poolId)))];
            // @ts-ignore
            const poolAccounts = await callWithRetry(() => program.account.poolState.fetchMultiple(uniquePoolIds));
            
            const poolMap = new Map();
            uniquePoolIds.forEach((id, i) => {
              if ((poolAccounts as any[])[i]) poolMap.set(id.toBase58(), (poolAccounts as any[])[i]);
            });

            const tickArrayPdas: PublicKey[] = [];
            validPositions.forEach(pos => {
              const poolAcc = poolMap.get(pos.poolId);
              const tickSpacing = poolAcc ? poolAcc.tickSpacing : 1;
              const safeSpacing = Math.max(1, tickSpacing);
              const tickCount = 60 * safeSpacing;
              
              const lowerStart = Math.floor(pos.tickLower / tickCount) * tickCount;
              const upperStart = Math.floor(pos.tickUpper / tickCount) * tickCount;
              
              const [lowerPda] = getTickArrayAddress(new PublicKey(pos.poolId), lowerStart, program.programId);
              const [upperPda] = getTickArrayAddress(new PublicKey(pos.poolId), upperStart, program.programId);
              
              tickArrayPdas.push(lowerPda, upperPda);
            });

            // @ts-ignore
            const tickArrays = await callWithRetry(() => program.account.tickArrayState.fetchMultiple(tickArrayPdas));

            if (tickArrays) {
              validPositions.forEach((pos, i) => {
                const lowerTa = (tickArrays as any[])[i * 2];
                const upperTa = (tickArrays as any[])[i * 2 + 1];
                
                if (lowerTa) {
                  const tickState = lowerTa.ticks.find((t: any) => t.tick === pos.tickLower);
                  if (tickState) pos.lowerTickOutsideGrowthX64 = tickState.rewardGrowthsOutsideX64.map((x: any) => x.toString());
                }
                
                if (upperTa) {
                  const tickState = upperTa.ticks.find((t: any) => t.tick === pos.tickUpper);
                  if (tickState) pos.upperTickOutsideGrowthX64 = tickState.rewardGrowthsOutsideX64.map((x: any) => x.toString());
                }
              });
            }
          } catch (err) {
            console.warn("[PositionsContext] Failed to fetch TickArrays for fresh rewards", err);
          }
        }
        // ------------------------------------------------------------------

        if (mounted) {
          setPositions(validPositions);
          setPositionsError(null);

          try {
            // Include wallet pubkey in cache to ensure we don't bleed cache between wallets
            sessionStorage.setItem(
              "positionsCache",
              JSON.stringify(validPositions),
            );
            sessionStorage.setItem(
              "positionsCacheWallet",
              publicKey.toBase58(),
            );
          } catch (e) {
            console.warn("Failed to cache positions", e);
          }
        }
      } catch (err) {
        console.error("[PositionsContext] Failed to load positions:", err);
        if (mounted)
          setPositionsError(
            (err as Error)?.message ?? "Failed to load positions",
          );
      } finally {
        if (mounted) {
          console.log(
            `[PositionsContext] Position loading complete, found ${positions.length} positions`,
          );
          setLoadingPositions(false);
        }
      }
    };

    loadPositions();

    return () => {
      mounted = false;
    };
  }, [connection, publicKey, program, refreshCounter, positions.length]);

  return (
    <PositionsContext.Provider
      value={{ positions, loadingPositions, positionsError, refreshPositions }}
    >
      {children}
    </PositionsContext.Provider>
  );
};

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import useProgram from "../utils/useProgram";
import { callWithRetry } from "../utils/batchFetch";

export type PoolRowData = {
  poolPda: string;
  poolCreator: string;
  ammConfig: string;
  tokenMint0: string;
  tokenMint1: string;
  tokenVault0: string;
  tokenVault1: string;
  mintDecimals0: number;
  mintDecimals1: number;
  tickSpacing: number;
  tickCurrent: number;
  liquidity: string;
  sqrtPriceX64: string;
  protocolFeesToken0: string;
  protocolFeesToken1: string;
  apr?: string;
  vault0Balance?: number | null;
  vault1Balance?: number | null;
  tradeFeeRate?: number;
  activeLiquidity0?: number | null;
  activeLiquidity1?: number | null;
  isActiveLiquidityLoading?: boolean;
  rewardInfos?: {
    tokenMint: string;
    initialized: boolean;
    openTime: number;
    endTime: number;
    emissionsPerSecondX64: string;
    rewardGrowthGlobalX64: string;
    lastUpdateTime: number;
    tokenDecimals?: number;
  }[];
};

const toBase58 = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toBase58 === "function") return obj.toBase58();
    if (typeof obj.toString === "function") return obj.toString();
  }
  return null;
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (value == null) return fallback;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  const numeric = Number(value.toString?.() ?? value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

interface PoolsContextType {
  pools: PoolRowData[];
  loadingPools: boolean;
  poolsError: string | null;
  refreshPools: () => void;
}

const PoolsContext = createContext<PoolsContextType>({
  pools: [],
  loadingPools: false,
  poolsError: null,
  refreshPools: () => {},
});

export const usePools = () => useContext(PoolsContext);
export { PoolsContext };

export const PoolsProvider = ({ children }: { children: ReactNode }) => {
  const program = useProgram();
  const { connection } = useConnection();

  const [pools, setPools] = useState<PoolRowData[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);
  const [poolsError, setPoolsError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refreshPools = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  useEffect(() => {
    let cancelled = false;

    const loadPools = async () => {
      if (!program) {
        if (!cancelled) {
          setPools([]);
          setPoolsError("Connect a wallet to load pools.");
        }
        return;
      }

      setLoadingPools(true);
      setPoolsError(null);

      try {
        console.log("[PoolsContext] Starting pool load");
        const programAccount = program.account as Record<
          string,
          {
            all: () => Promise<
              Array<{ publicKey: PublicKey; account: Record<string, unknown> }>
            >;
          }
        >;
        const rawPools = await callWithRetry(() => programAccount.poolState.all());
        console.log(
          `[PoolsContext] Fetched ${rawPools.length} pools from program`,
        );

        const ammConfigPubkeys = new Set<string>();
        rawPools.forEach((entry: any) => {
          const acc = entry.account ?? {};
          const ammConfigStr = toBase58(acc.ammConfig ?? acc.amm_config);
          if (ammConfigStr) ammConfigPubkeys.add(ammConfigStr);
        });

        const ammConfigFees = new Map<string, number>();
        const ammConfigArray = Array.from(ammConfigPubkeys).map(
          (p) => new PublicKey(p),
        );
        if (ammConfigArray.length > 0) {
          try {
            const accs =
              await callWithRetry(() => connection.getMultipleAccountsInfo(ammConfigArray));
            accs.forEach((acc, i) => {
              if (acc && acc.data && acc.data.length >= 51) {
                const tradeFeeRate = acc.data.readUInt32LE(47);
                ammConfigFees.set(ammConfigArray[i].toBase58(), tradeFeeRate);
              }
            });
          } catch (err) {
            console.error("[PoolsContext] AMM Config fetch error", err);
          }
        }
        
        const rewardMintPubkeys = new Set<string>();
        rawPools.forEach((entry: any) => {
          const acc = entry.account ?? {};
          if (acc.rewardInfos || acc.reward_infos) {
            const rInfos = (acc.rewardInfos ?? acc.reward_infos) as any[];
            rInfos.forEach(ri => {
              const mintStr = toBase58(ri.tokenMint ?? ri.token_mint);
              if (mintStr && mintStr !== "11111111111111111111111111111111") {
                rewardMintPubkeys.add(mintStr);
              }
            });
          }
        });

        const rewardMintDecimals = new Map<string, number>();
        const rewardMintArray = Array.from(rewardMintPubkeys).map(p => new PublicKey(p));
        if (rewardMintArray.length > 0) {
          try {
            const accs = await callWithRetry(() => connection.getMultipleAccountsInfo(rewardMintArray));
            accs.forEach((acc, i) => {
              if (acc && acc.data && acc.data.length >= 45) {
                const decimals = acc.data.readUInt8(44);
                rewardMintDecimals.set(rewardMintArray[i].toBase58(), decimals);
              }
            });
          } catch (err) {
            console.error("[PoolsContext] Reward Mint fetch error", err);
          }
        }

        const mappedPools: PoolRowData[] = rawPools.map(
          (entry: {
            publicKey: PublicKey;
            account: Record<string, unknown>;
          }) => {
            const account = entry.account ?? {};
            const ammConfig =
              toBase58(account.ammConfig ?? account.amm_config) ?? "";
            const tokenVault0 = toBase58(
              account.tokenVault0 ?? account.token_vault_0,
            );
            const tokenVault1 = toBase58(
              account.tokenVault1 ?? account.token_vault_1,
            );
            const dec0 = toNumber(
              account.mintDecimals0 ?? account.mint_decimals_0,
              6,
            );
            const dec1 = toNumber(
              account.mintDecimals1 ?? account.mint_decimals_1,
              6,
            );

            return {
              poolPda: entry.publicKey.toBase58(),
              poolCreator: toBase58(account.owner) ?? "",
              ammConfig: ammConfig,
              tokenMint0:
                toBase58(account.tokenMint0 ?? account.token_mint_0) ?? "",
              tokenMint1:
                toBase58(account.tokenMint1 ?? account.token_mint_1) ?? "",
              tokenVault0: tokenVault0 ?? "",
              tokenVault1: tokenVault1 ?? "",
              mintDecimals0: dec0,
              mintDecimals1: dec1,
              tickSpacing: toNumber(
                account.tickSpacing ?? account.tick_spacing,
                1,
              ),
              tickCurrent: toNumber(
                account.tickCurrent ?? account.tick_current,
                0,
              ),
              liquidity: String(
                account.liquidity?.toString?.() ?? account.liquidity ?? "0",
              ),
              sqrtPriceX64: String(
                account.sqrtPriceX64?.toString?.() ??
                  account.sqrt_price_x64 ??
                  "0",
              ),
              protocolFeesToken0: String(
                account.protocolFeesToken0?.toString?.() ??
                  account.protocol_fees_token_0 ??
                  "0",
              ),
              protocolFeesToken1: String(
                account.protocolFeesToken1?.toString?.() ??
                  account.protocol_fees_token_1 ??
                  "0",
              ),
              vault0Balance: null,
              vault1Balance: null,
              tradeFeeRate: ammConfigFees.get(ammConfig),
              isActiveLiquidityLoading: true,
              rewardInfos: account.rewardInfos ? (account.rewardInfos as any[]).map((ri) => {
                const mintStr = toBase58(ri.tokenMint ?? ri.token_mint) ?? "";
                return {
                  tokenMint: mintStr,
                  initialized: mintStr !== "11111111111111111111111111111111", // Default pubkey is uninitialized
                  openTime: toNumber(ri.openTime ?? ri.open_time),
                  endTime: toNumber(ri.endTime ?? ri.end_time),
                  emissionsPerSecondX64: String(ri.emissionsPerSecondX64?.toString?.() ?? ri.emissions_per_second_x64 ?? "0"),
                  rewardGrowthGlobalX64: String(ri.rewardGrowthGlobalX64?.toString?.() ?? ri.reward_growth_global_x64 ?? "0"),
                  lastUpdateTime: toNumber(ri.lastUpdateTime ?? ri.last_update_time),
                  tokenDecimals: rewardMintDecimals.get(mintStr) ?? 6
                };
              }) : [],
            };
          },
        );

        if (!cancelled) {
          console.log(
            `[PoolsContext] Setting ${mappedPools.length} pools to state`,
          );
          setPools(mappedPools);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[PoolsContext] Failed to load pools", error);
          setPools([]);
          setPoolsError(
            error instanceof Error ? error.message : "Failed to fetch pools",
          );
        }
      } finally {
        if (!cancelled) {
          console.log("[PoolsContext] Pool loading complete");
          setLoadingPools(false);
        }
      }
    };

    loadPools();

    return () => {
      cancelled = true;
    };
  }, [program, connection, refreshTrigger]);

  return (
    <PoolsContext.Provider
      value={{ pools, loadingPools, poolsError, refreshPools }}
    >
      {children}
    </PoolsContext.Provider>
  );
};

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { Connection } from "@solana/web3.js";
import {
  getTokenRegistry,
  addTokenToRegistry,
  TokenRegistryEntry,
  searchTokenRegistry,
} from "../utils/tokenRegistry";

interface TokenRegistryContextState {
  tokens: TokenRegistryEntry[];
  isLoading: boolean;
  error: string | null;
  addCustomToken: (
    connection: Connection,
    mint: string,
  ) => Promise<TokenRegistryEntry | null>;
  searchTokens: (query: string) => TokenRegistryEntry[];
}

const TokenRegistryContext = createContext<
  TokenRegistryContextState | undefined
>(undefined);

export function TokenRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tokens, setTokens] = useState<TokenRegistryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTokens(getTokenRegistry());
  }, []);

  const addCustomToken = useCallback(
    async (connection: Connection, mint: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const entry = await addTokenToRegistry(connection, mint);
        setTokens(getTokenRegistry());
        return entry;
      } catch (err: any) {
        setError(err.message || "Failed to add custom token");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const searchTokens = useCallback(
    (query: string) => {
      return searchTokenRegistry(query, tokens);
    },
    [tokens],
  );

  return (
    <TokenRegistryContext.Provider
      value={{ tokens, isLoading, error, addCustomToken, searchTokens }}
    >
      {children}
    </TokenRegistryContext.Provider>
  );
}

export function useTokenRegistry() {
  const context = useContext(TokenRegistryContext);
  if (context === undefined) {
    throw new Error(
      "useTokenRegistry must be used within a TokenRegistryProvider",
    );
  }
  return context;
}

import { Connection, PublicKey } from "@solana/web3.js";


export interface TokenRegistryEntry {
  mint: string;
  symbol: string;
  name: string;
  decimals?: number;
  color?: string;
}

const DEFAULT_TOKENS: TokenRegistryEntry[] = [
  {
    "mint": "DEzz2hBGDDPRC58WRpswFjYVH2M5BbhR9q6xVeTK2qKv",
    "symbol": "DEZZ",
    "name": "Token_DEZZ",
    "color": "hsl(288 72% 58%)"
  },
  {
    "mint": "DPRxNTFYPNM6EbJzbtwz655gHjwihLY4Huiidy97Lyuz",
    "symbol": "DPRX",
    "name": "Token_DPRX",
    "color": "hsl(110 72% 58%)"
  },
  {
    "mint": "BdTvzixaq1EFmDRjefVvcPZBxBkdAMQc2CuTpL6N57mj",
    "symbol": "BDTV",
    "name": "Token_BDTV",
    "color": "hsla(66, 83%, 43%, 1.00)"
  },
  {
    "mint": "7mXcUm1GNCX3NUfuFKXm2nRcNVRbJudXdDBUouJtxNUn",
    "symbol": "7MXC",
    "name": "Token_7MXC",
    "color": "hsl(205 72% 58%)"
  },
  {
    "mint": "DjVpbXvDAqmTjSpRaggzKWevjiywQmy3V8ps162tosKy",
    "symbol": "DJVP",
    "name": "Token_DJVP",
    "color": "hsl(3 72% 58%)"
  },
  {
    "mint": "WHfiThqeooR3CAKTWNHCTGA9zfxm5JjS3VsxLejDTVS",
    "symbol": "WHFI",
    "name": "Token_WHFI",
    "color": "hsla(63, 72%, 42%, 1.00)"
  },
  {
    "mint": "VWVyFkZgdEDoNEs46W2xsRtA8mGHz9r7rBWmyW1hhg3",
    "symbol": "VWVY",
    "name": "Token_VWVY",
    "color": "hsl(19 72% 58%)"
  },
  {
    "mint": "63Jp3VrqStknVLpgTMKhXf5khVSUUE8qCohetjUDy5DW",
    "symbol": "63JP",
    "name": "Token_63JP",
    "color": "hsl(250 72% 58%)"
  },
  {
    "mint": "FRYJVUuNHeH1jJ4D56TTgRZyFQ7jEQQdu1vpd4evdkPb",
    "symbol": "FRYJ",
    "name": "Token_FRYJ",
    "color": "hsl(233 72% 58%)"
  },
  {
    "mint": "H5nkCqzKhrB2Ewh2sXV1QzidAa7J5P8bmfQHDBCQgrRr",
    "symbol": "H5NK",
    "name": "Token_H5NK",
    "color": "hsl(95 72% 58%)"
  },
  {
    "mint": "67TVy6614jGojkLjecZkBrwanvZ1fjVpCDitPddBLHMd",
    "symbol": "67TV",
    "name": "Token_67TV",
    "color": "hsl(302 72% 58%)"
  },
  {
    "mint": "BXCXfa4L7RzLzdKVv1DnDcQRgf2RKt7SUPSrtcVB78Kt",
    "symbol": "BXCX",
    "name": "Token_BXCX",
    "color": "hsl(359 72% 58%)"
  },
  {
    "mint": "9JXRKWPG6LeijE9gDMePhPfFDh7ErM2sqvpLfPQoKzTL",
    "symbol": "9JXR",
    "name": "Token_9JXR",
    "color": "hsl(138 72% 58%)"
  }
]

export function getTokenRegistry(): TokenRegistryEntry[] {
  try {
    const localStr = localStorage.getItem("customTokenRegistry");
    if (localStr) {
      const localTokens: TokenRegistryEntry[] = JSON.parse(localStr);
      // Merge with defaults, preventing duplicates
      const merged = [...DEFAULT_TOKENS];
      for (const t of localTokens) {
        if (!merged.find(m => m.mint === t.mint)) {
          merged.push(t);
        }
      }
      return merged;
    }
  } catch (e) {
    console.error("Local storage error:", e);
  }
  return DEFAULT_TOKENS;
}

export async function addTokenToRegistry(
  _connection: Connection,
  mint: string
): Promise<TokenRegistryEntry | null> {
  // Validate mint
  try {
    new PublicKey(mint);
  } catch {
    throw new Error("Invalid token mint address");
  }

  // Basic check for existing
  const current = getTokenRegistry();
  const existing = current.find(t => t.mint === mint);
  if (existing) {
    return existing;
  }

  // We could fetch on-chain metadata here if desired.
  // For now, we fallback to a derived name.
  // generate fallback color based on address hash
  const hash = mint
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0);
  const hue = hash % 360;

  const entry: TokenRegistryEntry = {
    mint,
    symbol: mint.slice(0, 4).toUpperCase(),
    name: "Custom Token",
    decimals: 6, // default assumption if unknown
    color: `hsl(${hue}, 72%, 58%)`,
  };

  const newRegistry = [...current, entry];
  const customOnly = newRegistry.filter(
    t => !DEFAULT_TOKENS.find(d => d.mint === t.mint)
  );
  localStorage.setItem("customTokenRegistry", JSON.stringify(customOnly));
  
  return entry;
}

export function searchTokenRegistry(
  query: string,
  tokens: TokenRegistryEntry[]
): TokenRegistryEntry[] {
  if (!query) return tokens;
  const qStr = query.toLowerCase();
  return tokens.filter(
    t =>
      t.symbol.toLowerCase().includes(qStr) ||
      t.name.toLowerCase().includes(qStr) ||
      t.mint.toLowerCase().includes(qStr)
  );
}

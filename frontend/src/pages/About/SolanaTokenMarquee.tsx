import './SolanaTokenMarquee.css';

interface SolanaToken {
  symbol: string;
  name: string;
  icon: string;
  price: string;
  change24h: string;
  isPositive: boolean;
}

const solanaTokens: SolanaToken[] = [
  {
    symbol: 'SOL',
    name: 'Solana',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    price: '$182.40',
    change24h: '+4.2%',
    isPositive: true,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    price: '$1.00',
    change24h: '0.0%',
    isPositive: true,
  },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    icon: 'https://token.jup.ag/icon/JUP',
    price: '$1.12',
    change24h: '+8.5%',
    isPositive: true,
  },
  {
    symbol: 'PYTH',
    name: 'Pyth Network',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/HZ1Jov2PDhjhP2D325CJPwM222C6Y3sAnA459T58C12/logo.png',
    price: '$0.42',
    change24h: '-1.8%',
    isPositive: false,
  },
  {
    symbol: 'JTO',
    name: 'Jito',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL/logo.png',
    price: '$2.85',
    change24h: '+3.1%',
    isPositive: true,
  },
  {
    symbol: 'BONK',
    name: 'Bonk',
    icon: 'https://arweave.net/hQiP_LCh1A132eq0_9vqDxA3_B4RqwhB95GP_O1A6mg',
    price: '$0.000024',
    change24h: '-5.4%',
    isPositive: false,
  },
  {
    symbol: 'WIF',
    name: 'dogwifhat',
    icon: 'https://bafkreib2p63fn325k455d3o2j2p64s3k4g7fsqedl2n1b3543i.ipfs.nftstorage.link/',
    price: '$2.15',
    change24h: '+12.3%',
    isPositive: true,
  },
  {
    symbol: 'RENDER',
    name: 'Render Token',
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/rndrf23585555555555555555555555555555555555/logo.png',
    price: '$6.40',
    change24h: '+1.1%',
    isPositive: true,
  },
];

export const SolanaTokenMarquee = () => {
  // Duplicate array to create an uninterrupted infinite loop
  const displayTokens = [...solanaTokens, ...solanaTokens];

  return (
    <div className="marquee-container">
      <div className="marquee-track">
        {displayTokens.map((token, idx) => (
          <div key={idx} className="marquee-item">
            {/* Token Logo */}
            <img
              src={token.icon}
              alt={token.symbol}
              className="marquee-icon"
              onError={(e) => {
                // Fallback icon if URL breaks
                (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';
              }}
            />

            {/* Symbol & Name */}
            <div className="marquee-info">
              <span className="marquee-symbol">{token.symbol}</span>
              <span className="marquee-name">{token.name}</span>
            </div>

            {/* Price & 24h Change */}
            <div className="marquee-price-info">
              <span className="marquee-price">{token.price}</span>
              <span
                className={`marquee-change ${token.isPositive ? 'positive' : 'negative'
                  }`}
              >
                {token.change24h}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

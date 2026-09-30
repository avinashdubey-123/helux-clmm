interface Token {
  name: string;
  symbol: string;
  price: string;
  change: number;
}

// TODO: placeholder figures. Replace with live market data.
const ROWS: Token[][] = [
  [
    { name: 'Solana', symbol: 'SOL', price: '$120.42', change: 2.84 },
    { name: 'USD Coin', symbol: 'USDC', price: '$1.00', change: 0.01 },
    { name: 'Jupiter', symbol: 'JUP', price: '$0.684', change: -1.27 },
    { name: 'Jito', symbol: 'JTO', price: '$1.872', change: -2.14 },
    { name: 'Pyth', symbol: 'PYTH', price: '$0.138', change: 1.86 },
    { name: 'Drift', symbol: 'DRIFT', price: '$0.193', change: 4.21 },
  ],

  [
    { name: 'Tether', symbol: 'USDT', price: '$1.00', change: -0.02 },
    { name: 'Chainlink', symbol: 'LINK', price: '$18.64', change: 1.48 },
    { name: 'Wormhole', symbol: 'W', price: '$0.091', change: -0.74 },
    { name: 'dogwifhat', symbol: 'WIF', price: '$0.421', change: 5.73 },
    { name: 'Bonk', symbol: 'BONK', price: '$0.0000124', change: -3.18 },
    { name: 'Marinade', symbol: 'MNDE', price: '$0.064', change: 2.47 },
  ],
];

// Each set is repeated so the track stays wider than the screen while it loops.
// Keep this an even number: the CSS animation shifts the track by exactly half.
const COPIES = 4;

interface TokenCardProps {
  token: Token;
  hidden?: boolean;
}

function TokenCard({ token, hidden }: TokenCardProps) {
  const up = token.change >= 0;
  return (
    <li className="token" aria-hidden={hidden || undefined}>
      <div className="token__head">
        <div className="token__title">
          <span className="token__name">{token.name}</span>
          <span className="token__symbol">{token.symbol}</span>
        </div>
        {/* Letter tile stands in for the token logo */}
        <span className="token__icon" aria-hidden="true">{token.symbol.charAt(0)}</span>
      </div>
      <div className="token__foot">
        <span className="token__price">{token.price}</span>
        <span className={`token__change token__change--${up ? 'up' : 'down'}`}>
          {Math.abs(token.change).toFixed(2)}% {up ? '▲' : '▼'}
        </span>
      </div>
    </li>
  );
}

interface TickerRowProps {
  tokens: Token[];
  direction: 'left' | 'right';
}

function TickerRow({ tokens, direction }: TickerRowProps) {
  return (
    <div className={`ticker__row ticker__row--${direction}`}>
      <ul className="ticker__track">
        {Array.from({ length: COPIES }, (_, copy) =>
          tokens.map((token: Token) => (
            <TokenCard key={`${copy}-${token.symbol}`} token={token} hidden={copy > 0} />
          ))
        )}
      </ul>
    </div>
  );
}

export default function TokenTicker() {
  return (
    <section className="ticker" aria-label="Token prices">
      <TickerRow tokens={ROWS[0]} direction="right" />
      <TickerRow tokens={ROWS[1]} direction="left" />
    </section>
  );
}

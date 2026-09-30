import React from 'react';
import { Link } from 'react-router-dom';

// Liquidity distribution chart
const BAR_COUNT = 64;
const RANGE_START = 22; // first bar inside the selected range
const RANGE_END = 42;   // last bar inside the selected range
const CURRENT = 33;     // bar at the current price
const MAX_HEIGHT = 210; // px height the bar formula is scaled against

const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const g = Math.exp(-Math.pow((i - CURRENT) / 11, 2));
  const noise = ((i * 37) % 11) / 11;
  const h = Math.round(14 + 146 * g + 24 * noise * (0.35 + g));
  return {
    height: `${((h / MAX_HEIGHT) * 100).toFixed(2)}%`,
    active: i >= RANGE_START && i <= RANGE_END,
  };
});

const CHART_STYLE = {
  '--range-start': RANGE_START / BAR_COUNT,
  '--range-end': (RANGE_END + 1) / BAR_COUNT,
  '--current': (CURRENT + 0.5) / BAR_COUNT,
} as React.CSSProperties;

export default function Hero() {
  return (
    <section className="hero" id="about">
      <div className="hero__inner">
        <p className="hero__badge">
          <span className="hero__badge-dot" aria-hidden="true" />
          Trade with more control
        </p>

        <h1 className="hero__title">DeFi, built around <br />liquidity.</h1>

        <p className="hero__lead">
          Helux is a Solana-based trading and liquidity platform for swapping tokens,
          providing liquidity, and managing positions with precision.
        </p>

        <div className="hero__actions">
          <Link className="btn btn--primary" to="/swap">Launch App</Link>
          <Link className="btn btn--ghost" to="/liquidity">Explore pools</Link>
        </div>

        <div className="preview">
          <div className="preview__frame">
            <div className="panel">
              <header className="panel__head">
                <div className="pair">
                  <span className="pair__tokens" aria-hidden="true">
                    <span className="pair__token pair__token--a">SOL</span>
                    <span className="pair__token pair__token--b">USDC</span>
                  </span>
                  <span className="pair__name">SOL / USDC</span>
                  <span className="pair__fee">0.05%</span>
                </div>
                <div className="panel__status">
                  <span className="panel__price">Current price <b>120.42</b></span>
                  <span className="tag">In range</span>
                </div>
              </header>

              <div
                className="chart"
                style={CHART_STYLE}
                role="img"
                aria-label="Liquidity distribution for SOL / USDC, with the selected range between the min and max price highlighted around the current price"
              >
                <div className="chart__range" aria-hidden="true" />
                <div className="chart__bars" aria-hidden="true">
                  {BARS.map((bar, i) => (
                    <div
                      key={i}
                      className={`chart__bar${bar.active ? ' chart__bar--active' : ''}`}
                      style={{ '--h': bar.height, '--i': i } as React.CSSProperties}
                    />
                  ))}
                </div>
                <div className="chart__handle chart__handle--min" aria-hidden="true"><span>Min</span></div>
                <div className="chart__handle chart__handle--max" aria-hidden="true"><span>Max</span></div>
                <div className="chart__current" aria-hidden="true"><span>Current</span></div>
              </div>

              <dl className="stats">
                <div className="stat">
                  <dt>Min price</dt>
                  <dd>114.40</dd>
                </div>
                <div className="stat">
                  <dt>Max price</dt>
                  <dd>126.44</dd>
                </div>
                <div className="stat stat--accent">
                  <dt>Est. fee APR</dt>
                  <dd>22.5%</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

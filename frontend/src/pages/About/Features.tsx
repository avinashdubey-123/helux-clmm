import React from 'react';

// Bar heights (%) for the mini range chart; bars 4-8 are inside the range
const RANGE_BARS = [18, 26, 38, 52, 70, 86, 100, 90, 74, 56, 40, 28, 20];

export default function Features() {
  return (
    <section className="features" id="features">
      <div className="features__inner">
        <p className="eyebrow">Features</p>
        <h2 className="section-title">Built for Every Market Move.</h2>
        <p className="section-lead">Everything essential, arranged around the way markets actually move.</p>

        <div className="features__grid">
          <article className="feature feature--w7 feature--glow">
            <div className="feature__body">
              <p className="feature__category">Swap</p>
              <h3>Exchange Tokens</h3>
              <p>Swap between supported assets with a straightforward trading flow. Review the route, price impact, and expected output before you confirm.</p>
            </div>
            <div className="feature__visual feature__visual--swap" aria-hidden="true">
              <div className="swap-demo">
                <div className="swap-demo__row">
                  <span>From</span>
                  <span className="swap-demo__token"><i className="coin coin--a">S</i>SOL</span>
                </div>
                <span className="swap-demo__arrow">&darr;</span>
                <div className="swap-demo__row">
                  <span>To</span>
                  <span className="swap-demo__token"><i className="coin coin--b">U</i>USDC</span>
                </div>
              </div>
              <ul className="chips chips--column">
                <li>Select Pool</li>
                <li>Price impact</li>
                <li>Expected output</li>
              </ul>
            </div>
          </article>

          <article className="feature feature--w5">
            <div className="feature__visual" aria-hidden="true">
              <ul className="pool-list">
                <li>
                  <span className="pair__tokens"><i className="coin coin--a">S</i><i className="coin coin--b">U</i></span>
                  SOL / USDC
                </li>
                <li className="is-active">
                  <span className="pair__tokens"><i className="coin coin--a">J</i><i className="coin coin--b">U</i></span>
                  JUP / USDC
                  <em>Earning fees</em>
                </li>
                <li>
                  <span className="pair__tokens"><i className="coin coin--a">R</i><i className="coin coin--b">S</i></span>
                  RAY / SOL
                </li>
              </ul>
            </div>
            <div className="feature__body">
              <p className="feature__category">Liquidity</p>
              <h3>Liquidity Pools</h3>
              <p>Provide liquidity to Token Pools and earn a share of trading fees as users swap through the pool.</p>
            </div>
          </article>

          <article className="feature feature--w4">
            <div className="feature__visual" aria-hidden="true">
              <div className="range-demo">
                {RANGE_BARS.map((height, i) => (
                  <span
                    key={i}
                    className={i >= 4 && i <= 8 ? 'is-active' : undefined}
                    style={{ '--h': `${height}%` } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>
            <div className="feature__body">
              <p className="feature__category">Precision</p>
              <h3>Concentrated Liquidity</h3>
              <p>Choose the price ranges where your liquidity works hardest. Adjust your position as the market moves and your strategy changes.</p>
            </div>
          </article>

          <article className="feature feature--w4 feature--glow">
            <div className="feature__visual" aria-hidden="true">
              <ul className="chips chips--stack">
                <li><span className="status status--on" />Track</li>
                <li><span className="status" />Adjust</li>
                <li><span className="status" />Understand</li>
              </ul>
            </div>
            <div className="feature__body">
              <p className="feature__category">Control</p>
              <h3>Position Management</h3>
              <p>Track, adjust, and understand each position from one place.</p>
            </div>
          </article>

          <article className="feature feature--w4">
            <div className="feature__visual" aria-hidden="true">
              <div className="farm-demo">
                <span className="farm-demo__box">Eligible position</span>
                <span className="farm-demo__plus">+</span>
                <span className="farm-demo__box farm-demo__box--accent">Rewards</span>
              </div>
            </div>
            <div className="feature__body">
              <p className="feature__category">Farm</p>
              <h3>Farms &amp; Rewards</h3>
              <p>Explore available liquidity incentives and put eligible positions to work for additional rewards.</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

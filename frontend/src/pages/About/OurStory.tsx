import chainHand from '../../assets/chain-hand.png';

export default function OurStory() {
  return (
    <section className="story" id="our-story">
      <div className="story__inner">
        <p className="eyebrow">Our Story</p>
        <h2 className="story__title">Powering Solana’s Liquidity Flow.</h2>

        <div className="story__stage">
          <img
            className="story__visual"
            src={chainHand}
            alt="A hand holding two linked chain links made of digital blocks"
            width="1405"
            height="1119"
            loading="lazy"
          />

          <div className="story__note story__note--left">
            <span className="pill">Beyond the swap</span>
            <p>A swap is only one part of DeFi. You might be looking for a better entry, providing liquidity, managing a position, or putting idle assets to work.</p>
          </div>

          <div className="story__note story__note--right">
            <span className="pill">One interface</span>
            <p>Helux connects these actions in one interface, so you can move from discovering a market to taking action without jumping between disconnected tools.</p>
          </div>

          <div className="float-card float-card--top" aria-hidden="true">
            <span className="float-card__title">Liquidity</span>
            <span className="float-card__sub">Active pool</span>
            <div className="float-card__pair">
              <span className="pair__tokens">
                <span className="pair__token pair__token--a">S</span>
                <span className="pair__token pair__token--b">U</span>
              </span>
              <span>SOL / USDC</span>
            </div>
          </div>

          <div className="float-card float-card--bottom" aria-hidden="true">
            <span className="float-card__title">Position</span>
            <span className="float-card__sub">Est. fee APR</span>
            {/* TODO: placeholder value */}
            <span className="float-card__value">22.5%</span>
          </div>
        </div>
      </div>
    </section>
  );
}

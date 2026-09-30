import logo from '../../assets/helux-logo.svg';

export default function HowItWorks() {
  return (
    <section className="hiw" id="how-it-works">
      <div className="hiw__inner">
        <div className="hiw__copy">
          <p className="eyebrow">How It Works</p>
          <h2 className="section-title hiw__title">From Swap to Providing Liquidity, without the friction.</h2>
          <p className="hiw__lead">
            Select any token pair, evaluate market depth, and deploy your capital on your terms.
            Execute immediate swaps, provision pool liquidity, or build concentrated price ranges
            with real-time portfolio visibility.
          </p>
        </div>

        <div className="hiw__stage" aria-hidden="true">
          <div className="hiw__tile"><img src={logo} alt="" width="36" height="36" /></div>

          <div className="hiw__card">
            <span className="hiw__card-label">Token pair</span>
            <div className="hiw__card-pair">
              <span className="pair__tokens"><i className="coin coin--a">S</i><i className="coin coin--b">U</i></span>
              SOL / USDC
            </div>
            <ul className="hiw__card-options">
              <li className="is-active">Swap</li>
              <li>Pool liquidity</li>
              <li>Concentrated range</li>
            </ul>
          </div>

          <div className="window hiw__window">
            <div className="window__bar"><i /><i /><i /><span>Helux</span></div>
            <ol className="hiw__steps">
              <li><b>1</b><span>Select any token pair</span></li>
              <li><b>2</b><span>Evaluate market depth</span></li>
              <li><b>3</b><span>Deploy your capital on your terms</span></li>
            </ol>
          </div>

          <div className="window hiw__panel">
            <div className="window__bar"><i /><i /><i /><span>Portfolio</span></div>
            <div className="hiw__rows">
              <div><span>Swaps</span><em /></div>
              <div><span>Pool liquidity</span><em /></div>
              <div><span>Price ranges</span><em /></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Link } from 'react-router-dom';

export default function Cta() {
  return (
    <section className="cta">
      <div className="cta__panel">
        <p className="cta__badge">Start where you are</p>
        <h2 className="section-title">Explore decentralized markets.</h2>
        <p className="section-lead">Swap tokens, discover liquidity, and manage positions through a focused DeFi interface.</p>
        <Link className="btn btn--primary" to="/liquidity">Get Started <span aria-hidden="true">&#8599;</span></Link>
      </div>
    </section>
  );
}

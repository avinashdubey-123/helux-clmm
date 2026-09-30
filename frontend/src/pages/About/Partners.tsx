// TODO: placeholder names shown as text. Replace with Helux's real partners and their logo files
// (render an <img> inside the <li>; .partners__logo img is already styled).
const PARTNERS = [
  'Solana',
  'Jupiter',
  'Orca',
  'Pyth',
  'Jito',
];

// Repeated so the strip can loop. Keep this an even number: the CSS animation shifts by half.
const COPIES = 4;

export default function Partners() {
  return (
    <section className="partners" aria-label="Partners">
      <div className="partners__inner">
        <div className="partners__marquee">
          <ul className="partners__list">
            {Array.from({ length: COPIES }, (_, copy) =>
              PARTNERS.map((name) => (
                <li key={`${copy}-${name}`} className="partners__logo" aria-hidden={copy > 0 || undefined}>
                  {name}
                </li>
              ))
            )}
          </ul>
        </div>
        <p className="partners__caption">
          Built for the <b>protocols, liquidity providers,</b> and <b>infrastructure </b>
          powering the decentralized ecosystem.
        </p>
      </div>
    </section>
  );
}

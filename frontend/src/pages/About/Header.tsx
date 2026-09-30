import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import logo from '../../assets/helux-logo.svg';

const NAV_LINKS = [
  { id: 'about', label: 'About' },
  { id: 'our-story', label: 'Our Story' },
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How It Works' },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState('about');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        rootMargin: '-120px 0px -60% 0px', // Trigger slightly below the fixed header
      }
    );

    NAV_LINKS.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, []);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="logo" href="#about" aria-label="Helux home">
          <img className="logo__mark" src={logo} alt="" width="40" height="40" />
          <span className="logo__name">Helux</span>
        </a>

        <button
          className="nav-toggle"
          type="button"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>

        <nav className={`site-nav${menuOpen ? ' is-open' : ''}`} id="site-nav" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.id}
              className={`site-nav__link${link.id === activeId ? ' is-active' : ''}`}
              href={`#${link.id}`}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <Link className="btn btn--primary btn--sm site-header__cta" to="/liquidity">Get Started</Link>
      </div>
    </header>
  );
}

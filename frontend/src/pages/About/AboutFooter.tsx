import { Link } from 'react-router-dom'
import heluxLogo from '../../assets/helux-logo.svg'

export default function AboutFooter() {
  return (
    <footer className="about-footer">
      <div className="about-footer__brand">
        <Link to="/" className="about-logo" aria-label="Helux home">
          <img src={heluxLogo} alt="Helux" />
        </Link>
        <p>A focused interface for exploring decentralized markets.</p>
      </div>
      <div className="about-footer__column">
        <p className="about-footer__label">Protocol</p>
        <a href="#documentation">Documentation</a>
        <a href="#developers">Developers</a>
      </div>
      <div className="about-footer__column">
        <p className="about-footer__label">Need Help?</p>
        <a href="#help-center">Help Center</a>
        <a href="#contact-us">Contact Us</a>
      </div>
      <div className="about-footer__bottom">
        <small>© 2026 Helux</small>
        <span>GitHub · X</span>
      </div>
    </footer>
  )
}

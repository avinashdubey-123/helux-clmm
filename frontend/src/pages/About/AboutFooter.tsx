import { Link } from "react-router-dom";
import heluxLogo from "../../assets/helux-logo.svg";
import githubIcon from "../../assets/github.svg";
import xIcon from "../../assets/x-social-media.svg";

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
        <p>© 2026 Helux</p>

        <div className="about-footer__socials" aria-label="Social links">
          <a href="#github" aria-label="GitHub">
            <img src={githubIcon} alt="" aria-hidden="true" />
          </a>

          <a href="#x" aria-label="X">
            <img src={xIcon} alt="" aria-hidden="true" />
          </a>
        </div>
      </div>
    </footer>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import "swiper/css";
import heluxLogo from "../../assets/helux-logo.svg";
import setupWizard from "../../assets/setup-wizard.svg";
import budgeting from "../../assets/budgeting.svg";
import completed from "../../assets/completed.svg";
import fileSearching from "../../assets/file-searching.svg";
import keyInsights from "../../assets/key-insights.svg";
import makeItRain from "../../assets/make-it-rain.svg";
import reviewingDesign from "../../assets/reviewing-design.svg";
import webSearch from "../../assets/web-search.svg";
import AboutFooter from "./AboutFooter";
import "./About.css";

const sections = [
  { id: "about", label: "About" },
  { id: "our-story", label: "Our Story" },
  { id: "how-it-works", label: "How It Works" },
  { id: "features", label: "Features" },
  { id: "ecosystem", label: "The Ecosystem" },
];

const features = [
  [
    "Swap",
    "Exchange Tokens",
    "Swap between supported assets with a straightforward trading flow. Review the route, price impact, and expected output before you confirm.",
  ],
  [
    "Liquidity",
    "Liquidity Pools",
    "Provide liquidity to Token Pools and earn a share of trading fees as users swap through the pool.",
  ],
  [
    "Precision",
    "Concentrated Liquidity",
    "Choose the price ranges where your liquidity works hardest. Adjust your position as the market moves and your strategy changes.",
  ],
  [
    "Control",
    "Position Management",
    "Track, adjust, and understand each position from one place.",
  ],
  [
    "Farm",
    "Farms & Rewards",
    "Explore available liquidity incentives and put eligible positions to work for additional rewards.",
  ],
  [
    "Portfolio",
    "Asset Management",
    "Monitor and manage your liquidity positions, balances, earned fees, and rewards on a single interface.",
  ],
];

const featureAssets = [
  keyInsights,
  completed,
  webSearch,
  reviewingDesign,
  makeItRain,
  fileSearching,
];

export default function About() {
  const [activeSection, setActiveSection] = useState("about");
  const [featureIndex, setFeatureIndex] = useState(0);

  useEffect(() => {
    const observedSections = sections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (first, second) =>
              second.intersectionRatio - first.intersectionRatio,
          )[0];

        if (visibleEntry) setActiveSection(visibleEntry.target.id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0.1, 0.3, 0.6] },
    );

    observedSections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const italicHeadings = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".about-page h1 em, .about-page h2 em",
      ),
    );
    const revealHeading = (heading: HTMLElement) => {
      heading.classList.add("is-visible");
      observer.unobserve(heading);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            revealHeading(entry.target as HTMLElement);
          }
        });
      },
      { threshold: 0 },
    );

    italicHeadings.forEach((heading) => {
      const bounds = heading.getBoundingClientRect();
      if (bounds.top < window.innerHeight && bounds.bottom > 0) {
        revealHeading(heading);
      } else {
        observer.observe(heading);
      }
    });
    return () => observer.disconnect();
  }, []);

  const featureSwiper = useRef<SwiperInstance | null>(null);

  return (
    <div className="about-page">
      <header className="about-header">
        <Link to="/" className="about-logo" aria-label="Helux home">
          <img src={heluxLogo} alt="Helux" />
        </Link>
        <nav className="about-nav" aria-label="About navigation">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={activeSection === section.id ? "is-active" : ""}
              aria-current={activeSection === section.id ? "page" : undefined}
            >
              <span>{section.label}</span>
            </a>
          ))}
        </nav>
        <Link to="/liquidity" className="about-start-button">
          Get Started
        </Link>
      </header>

      <div className="about-layout">
        <main className="about-content">
          <section id="about" className="about-hero about-section">
            <p className="about-kicker">Trade with more control</p>
            <h1>
              DeFi, built around <em>liquidity.</em>
            </h1>
            <p className="about-lede">
              Helux is a Solana-based decentralized trading and liquidity
              platform for swapping tokens, providing liquidity, and managing
              positions with precision.
            </p>
            <p className="about-lede">
              Discover markets, choose where your liquidity works, and keep
              every part of your DeFi activity connected in one focused
              interface.
            </p>

            <div className="asset-placeholder about-hero__asset about-illustration">
              <img src={webSearch} alt="" aria-hidden="true" />
            </div>
          </section>

          <section
            id="our-story"
            className="about-section about-split about-split--asset-first"
          >
            <div className="asset-placeholder about-illustration">
              <img src={reviewingDesign} alt="" aria-hidden="true" />
            </div>
            <div className="about-copy">
              <p className="about-kicker">Our Story</p>
              <h2>
                Powering Solana’s <em>Liquidity</em> Flow.
              </h2>
              <p>
                A swap is only one part of DeFi. You might be looking for a
                better entry, providing liquidity, managing a position, or
                putting idle assets to work.
              </p>
              <p>
                Helux connects these actions in one interface, so you can move
                from discovering a market to taking action without jumping
                between disconnected tools.
              </p>
            </div>
          </section>

          <section id="how-it-works" className="about-section about-split">
            <div className="about-copy">
              <p className="about-kicker">How It Works</p>
              <h2>
                From Swap to Providing Liquidity, <em>without the friction.</em>
              </h2>
              <p>
                Select any token pair, evaluate market depth, and deploy your
                capital on your terms. Execute immediate swaps, provision pool
                liquidity, or build concentrated price ranges with real-time
                portfolio visibility.
              </p>
            </div>
            <div className="asset-placeholder about-illustration">
              <img src={setupWizard} alt="A setup workflow" />
            </div>
          </section>

          <section id="features" className="about-section">
            <div className="about-section-heading">
              <div>
                <p className="about-kicker">Features</p>
                <h2>
                  Built for Every <em>Market</em> Move.
                </h2>
                <p>
                  Everything essential, arranged around the way markets actually
                  move.
                </p>
              </div>
            </div>
            <div
              className="features-carousel"
              aria-roledescription="carousel"
              aria-label="Helux features"
            >
              <Swiper
                className="features-swiper"
                centeredSlides
                loop
                slidesPerView={3}
                spaceBetween={12}
                speed={550}
                slideToClickedSlide
                onSwiper={(swiper) => {
                  featureSwiper.current = swiper;
                }}
                onSlideChange={(swiper) => setFeatureIndex(swiper.realIndex)}
              >
                {features.map(([category, title, description], index) => (
                  <SwiperSlide key={title}>
                    <article
                      className={`feature-card ${index === featureIndex ? "is-feature-active" : ""}`}
                      onClick={() => featureSwiper.current?.slideToLoop(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          featureSwiper.current?.slideToLoop(index);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        index === featureIndex
                          ? `${title}, current feature`
                          : `Show ${title}`
                      }
                    >
                      <div className="asset-placeholder about-illustration">
                        <img
                          src={featureAssets[index]}
                          alt=""
                          aria-hidden="true"
                        />
                      </div>
                      <p className="feature-card__category">{category}</p>
                      <h3>{title}</h3>
                      <p>{description}</p>
                    </article>
                  </SwiperSlide>
                ))}
              </Swiper>
              <div className="feature-cards" aria-label="Feature card index">
                {features.map(([, title], index) => (
                  <button
                    className={`feature-progress ${index === featureIndex ? "is-active" : ""}`}
                    key={title}
                    type="button"
                    aria-label={`Show ${title}`}
                    aria-current={index === featureIndex ? "true" : undefined}
                    onClick={() => featureSwiper.current?.slideToLoop(index)}
                  >
                    <span />
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section id="ecosystem" className="about-section about-ecosystem">
            <div className="about-copy about-ecosystem__heading">
              <p className="about-kicker">The Ecosystem</p>
              <h2>
                One protocol, <em>multiple ways</em> to participate.
              </h2>
            </div>
            <div className="about-ecosystem__body">
              <div className="about-copy">
                <p>
                  Traders need liquidity. Liquidity providers need markets with
                  real activity. Incentives help attract capital, while
                  concentrated positions give liquidity providers more control
                  over where their capital is deployed.
                </p>
                <p>
                  Helux brings these pieces together so that swapping, providing
                  liquidity, managing positions, and earning rewards feel like
                  parts of the same system.
                </p>
              </div>
              <div className="asset-placeholder about-ecosystem__asset about-illustration">
                <img
                  src={budgeting}
                  alt="A connected view of financial activity"
                />
              </div>
            </div>
          </section>

          <section className="about-cta">
            <p className="about-kicker">Start where you are</p>
            <h2>
              Explore <em>decentralized markets.</em>
            </h2>
            <p>
              Swap tokens, discover liquidity, and manage positions through a
              focused DeFi interface.
            </p>
            <Link to="/liquidity" className="about-cta__button">
              Get Started
            </Link>
          </section>
        </main>
      </div>
      <AboutFooter />
    </div>
  );
}

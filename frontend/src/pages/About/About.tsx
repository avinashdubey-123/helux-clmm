import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Swiper, SwiperSlide } from 'swiper/react'
import type { Swiper as SwiperInstance } from 'swiper'
import 'swiper/css'
import heluxLogo from '../../assets/helux-logo.svg'
import setupWizard from '../../assets/setup-wizard.svg'
import budgeting from '../../assets/budgeting.svg'
import completed from '../../assets/completed.svg'
import fileSearching from '../../assets/file-searching.svg'
import keyInsights from '../../assets/key-insights.svg'
import makeItRain from '../../assets/make-it-rain.svg'
import reviewingDesign from '../../assets/reviewing-design.svg'
import webSearch from '../../assets/web-search.svg'
import AboutFooter from './AboutFooter'
import './About.css'

const sections = [
  { id: 'about', label: 'About' },
  { id: 'our-story', label: 'Our Story' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'features', label: 'Features' },
  { id: 'ecosystem', label: 'The Ecosystem' },
]

const features = [
  ['Market access', 'Token Swaps', 'Move between assets through a direct, focused swap experience.'],
  ['Liquidity', 'Liquidity Pools', 'Supply capital to markets and participate in the flow of every trade.'],
  ['Precision', 'Concentrated Liquidity', 'Choose the price ranges where your liquidity works hardest.'],
  ['Control', 'Position Management', 'Track, adjust, and understand each position from one place.'],
  ['Incentives', 'Farms & Rewards', 'Put liquidity to work with transparent programs and rewards.'],
  ['Visibility', 'Transaction Activity', 'Follow every approval, swap, deposit, and reward claim.'],
]

const featureAssets = [keyInsights, completed, webSearch, reviewingDesign, makeItRain, fileSearching]

export default function About() {
  const [activeSection, setActiveSection] = useState('about')
  const [featureIndex, setFeatureIndex] = useState(0)

  useEffect(() => {
    const observedSections = sections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section))

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0]

        if (visibleEntry) setActiveSection(visibleEntry.target.id)
      },
      { rootMargin: '-18% 0px -62% 0px', threshold: [0.1, 0.3, 0.6] },
    )

    observedSections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const italicHeadings = Array.from(
      document.querySelectorAll<HTMLElement>('.about-page h1 em, .about-page h2 em'),
    )
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 },
    )

    italicHeadings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [])

  const featureSwiper = useRef<SwiperInstance | null>(null)

  return (
    <div className="about-page">
      <header className="about-header">
        <Link to="/" className="about-logo" aria-label="Helux home">
          <img src={heluxLogo} alt="Helux" />
        </Link>
        <Link to="/liquidity" className="about-start-button">Get Started</Link>
      </header>

      <div className="about-layout">
        <aside className="about-sidebar" aria-label="About navigation">
          <nav className="about-nav">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={activeSection === section.id ? 'is-active' : ''}
                aria-current={activeSection === section.id ? 'page' : undefined}
              >
                <span>{section.label}</span>
              </a>
            ))}
          </nav>
        </aside>

        <main className="about-content">
          <section id="about" className="about-hero about-section">
            <p className="about-kicker">A clearer way to participate</p>
            <h1>DeFi, with <em>room to think.</em></h1>
            <p className="about-lede">Helux is a concentrated-liquidity platform for people who want to move through decentralized markets with precision, context, and control.</p>
            <div className="asset-placeholder about-hero__asset about-illustration">
              <img src={webSearch} alt="" aria-hidden="true" />
            </div>
          </section>

          <section id="our-story" className="about-section about-split about-split--asset-first">
            <div className="asset-placeholder about-illustration">
              <img src={reviewingDesign} alt="" aria-hidden="true" />
            </div>
            <div className="about-copy">
              <p className="about-kicker">Our Story</p>
              <h2>Built for the space between a <em>trade</em> and a strategy.</h2>
              <p>DeFi tools often ask users to trade clarity for capability. Helux brings both together: a considered interface for swaps, liquidity, positions, and the decisions that connect them.</p>
              <p>Every surface is designed to make market activity easier to read and easier to act on.</p>
            </div>
          </section>

          <section id="how-it-works" className="about-section about-split">
            <div className="about-copy">
              <p className="about-kicker">How It Works</p>
              <h2>One market, viewed from every <em>useful angle.</em></h2>
              <p>Start with a swap, provide liquidity to a pool, or open a position around the prices you care about. Helux keeps the underlying activity connected, so each action has a clear next step.</p>
              <div className="about-process"><span>01 / Connect</span><span>02 / Choose</span><span>03 / Participate</span></div>
            </div>
            <div className="asset-placeholder about-illustration">
              <img src={setupWizard} alt="A setup workflow" />
            </div>
          </section>

          <section id="features" className="about-section">
            <div className="about-section-heading">
              <div><p className="about-kicker">Features</p><h2>A focused toolkit for <em>active liquidity.</em></h2><p>Everything essential, arranged around the way markets actually move.</p></div>
            </div>
            <div className="features-carousel" aria-roledescription="carousel" aria-label="Helux features">
              <Swiper
                className="features-swiper"
                centeredSlides
                loop
                slidesPerView={3}
                spaceBetween={12}
                speed={550}
                slideToClickedSlide
                onSwiper={(swiper) => { featureSwiper.current = swiper }}
                onSlideChange={(swiper) => setFeatureIndex(swiper.realIndex)}
              >
                {features.map(([category, title, description], index) => (
                  <SwiperSlide key={title}>
                    <article
                      className={`feature-card ${index === featureIndex ? 'is-feature-active' : ''}`}
                      onClick={() => featureSwiper.current?.slideToLoop(index)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          featureSwiper.current?.slideToLoop(index)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={index === featureIndex ? `${title}, current feature` : `Show ${title}`}
                    >
                      <div className="asset-placeholder about-illustration">
                        <img src={featureAssets[index]} alt="" aria-hidden="true" />
                      </div>
                      <p className="feature-card__category">{category}</p>
                      <h3>{title}</h3>
                      <p>{description}</p>
                    </article>
                  </SwiperSlide>
                ))}
              </Swiper>
              <div className="feature-progress-row" aria-label="Feature card index">
                {features.map(([, title], index) => (
                  <button
                    className={`feature-progress ${index === featureIndex ? 'is-active' : ''}`}
                    key={title}
                    type="button"
                    aria-label={`Show ${title}`}
                    aria-current={index === featureIndex ? 'true' : undefined}
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
              <h2>One connected place for the <em>full liquidity loop.</em></h2>
            </div>
            <div className="about-ecosystem__body">
              <div className="about-copy">
                <p>Swaps create demand. Pools make markets possible. Positions express intent. Farms reward participation. Activity ties the whole system together.</p>
                <p>Helux gives each part its own clarity while keeping the relationship between them visible.</p>
              </div>
              <div className="asset-placeholder about-ecosystem__asset about-illustration">
                <img src={budgeting} alt="A connected view of financial activity" />
              </div>
            </div>
          </section>

          <section className="about-cta">
            <p className="about-kicker">Start where you are</p>
            <h2>Explore <em>decentralized markets.</em></h2>
            <p>Swap tokens, discover liquidity, and manage positions through a focused DeFi interface.</p>
            <Link to="/liquidity" className="about-cta__link">Get Started<span>↗</span></Link>
          </section>
        </main>
      </div>
      <AboutFooter />
    </div>
  )
}
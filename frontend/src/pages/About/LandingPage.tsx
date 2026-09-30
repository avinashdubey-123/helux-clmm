import './LandingPage.css';
import Header from './Header';
import Hero from './Hero';
import TokenTicker from './TokenTicker';
import OurStory from './OurStory';
import Partners from './Partners';
import Features from './Features';
import HowItWorks from './HowItWorks';
import Cta from './Cta';
import Footer from './Footer';

export default function LandingPage() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <TokenTicker />
        <OurStory />
        <Partners />
        <Features />
        <HowItWorks />
        <Cta />
      </main>
      <Footer />
    </>
  );
}

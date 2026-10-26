import Link from "next/link";
import BrandMark from "./BrandMark";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-shell footer-grid">
        <div className="footer-brand">
          <BrandMark />
          <p>Studio-level 2D animation tools, production-ready characters and AI-assisted creative workflows.</p>
          <a href="mailto:hello@characterbazaarstudio.com">hello@characterbazaarstudio.com</a>
        </div>
        <div><h4>Platform</h4><Link href="/features#studio">Studio Animation</Link><Link href="/features#characters">AI Characters</Link><Link href="/features#backgrounds">AI Backgrounds</Link><Link href="/templates">Templates</Link></div>
        <div><h4>Resources</h4><Link href="/features">How it works</Link><Link href="/#faq">FAQs</Link><Link href="/pricing">Pricing</Link><a href="mailto:hello@characterbazaarstudio.com">Support</a></div>
        <div><h4>Company</h4><a href="https://characterbazaar.com" target="_blank" rel="noreferrer">CharacterBazaar</a><Link href="/dashboard">Get started</Link><span>Terms of Service</span><span>Privacy Policy</span></div>
      </div>
      <div className="site-shell footer-bottom">
        <span>© 2026 CharacterBazaarStudio. All rights reserved.</span>
        <span>Built for animators, studios & storytellers.</span>
      </div>
    </footer>
  );
}

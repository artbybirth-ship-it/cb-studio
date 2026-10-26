"use client";

import Link from "next/link";
import { useState } from "react";
import BrandMark from "./BrandMark";

const featureLinks = [
  ["AI Characters", "/features#characters"],
  ["AI Backgrounds", "/features#backgrounds"],
  ["AI Voiceover", "/features#voice"],
  ["Studio Animation", "/features#studio"],
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <BrandMark />
        <nav className="desktop-nav" aria-label="Main navigation">
          <details className="nav-details">
            <summary>Tools <span>⌄</span></summary>
            <div className="nav-popover nav-popover-tools">
              {featureLinks.map(([label, href]) => (
                <Link key={label} href={href} className="nav-tool-card">
                  <span className="nav-tool-icon">✦</span>
                  <span><strong>{label}</strong><small>Creator-ready AI workflow</small></span>
                </Link>
              ))}
            </div>
          </details>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/templates">Templates</Link>
          <details className="nav-details">
            <summary>Resources <span>⌄</span></summary>
            <div className="nav-popover nav-popover-small">
              <Link href="/#faq">FAQs</Link>
              <Link href="/features">How it works</Link>
              <Link href="mailto:hello@characterbazaarstudio.com">Contact us</Link>
            </div>
          </details>
        </nav>
        <div className="header-actions desktop-actions">
          <Link href="/dashboard" className="link-button">Login</Link>
          <Link href="/dashboard" className="primary-button header-cta">Open Studio</Link>
        </div>
        <button className="mobile-menu-button" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
          <span /><span /><span />
        </button>
      </div>
      {open && (
        <div className="mobile-nav">
          <div className="site-shell mobile-nav-inner">
            <Link href="/features" onClick={() => setOpen(false)}>Features</Link>
            <Link href="/pricing" onClick={() => setOpen(false)}>Pricing</Link>
            <Link href="/templates" onClick={() => setOpen(false)}>Templates</Link>
            <Link href="/#faq" onClick={() => setOpen(false)}>FAQs</Link>
            <div className="mobile-nav-actions">
              <Link href="/dashboard" className="secondary-button">Login</Link>
              <Link href="/dashboard" className="primary-button">Open Studio</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

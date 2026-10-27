"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "./brand";
export function LandingNav() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current)
        ref.current.dataset.scrolled = String(window.scrollY > 24);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <header className="landing-nav" ref={ref}>
      <div className="landing-nav-inner">
        <Link href="/" className="brand" aria-label="FlowGuard home">
          <BrandMark />
          <span>FlowGuard</span>
        </Link>
        <nav className="landing-nav-links" aria-label="Page navigation">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <Link className="button secondary" href="/app">
          Open workspace
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </header>
  );
}

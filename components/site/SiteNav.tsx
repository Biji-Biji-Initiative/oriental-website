"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useVoice } from "@/components/voice-agent/voice-state";
import { navItems } from "@/lib/content";
import { cn } from "@/lib/utils";

const sectionIds = navItems.map(([id]) => id);

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(sectionIds[0] ?? "vision");
  const voice = useVoice();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target.id;
        if (top) setActiveSection(top);
      },
      { rootMargin: "-28% 0px -58% 0px", threshold: [0, 0.15, 0.35, 0.55] },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code === "Escape") setMenuOpen(false);
      if (event.code === "Space" && event.target === document.body && !menuOpen) {
        event.preventDefault();
        voice.open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [voice, menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <>
      <header
        className={cn(
          "fixed left-0 right-0 top-0 z-40 flex items-center justify-between gap-4 px-5 py-4 text-white transition duration-300 md:px-9",
          scrolled && "bg-mk-off-black/82 shadow-2xl backdrop-blur-xl",
        )}
      >
        <a className="flex items-center gap-3 text-sm font-semibold tracking-[0.18em]" href="#top">
          <Image alt="Mereka" className="h-5 w-auto" height={26} src="/assets/mereka-white.png" width={112} />
          <span className="text-white/48">×</span>
          <span>ORIENTAL</span>
        </a>
        <nav
          aria-label="Section menu"
          className="hidden items-center gap-6 text-xs font-medium uppercase tracking-[0.12em] text-white/62 lg:flex"
        >
          {navItems.map(([id, label]) => (
            <a
              className={cn(
                "site-nav__link relative transition hover:text-white",
                activeSection === id && "site-nav__link--active text-white",
              )}
              href={`#${id}`}
              key={id}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="site-nav__menu-btn lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
          <button
            className="flex items-center gap-2 rounded-full border border-white/16 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] backdrop-blur transition hover:bg-white/18"
            onClick={() => voice.open()}
            type="button"
          >
            <MiniOrb size={24} />
            <span className="hidden sm:inline">Talk to Mereka</span>
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className="site-nav__mobile-panel lg:hidden">
          <button aria-label="Close menu" className="site-nav__mobile-backdrop" onClick={closeMenu} type="button" />
          <nav aria-label="Mobile section menu" className="site-nav__mobile-nav">
            {navItems.map(([id, label]) => (
              <a
                className={cn("site-nav__mobile-link", activeSection === id && "site-nav__mobile-link--active")}
                href={`#${id}`}
                key={id}
                onClick={closeMenu}
              >
                {label}
              </a>
            ))}
            <button
              className="site-nav__mobile-voice"
              onClick={() => {
                closeMenu();
                voice.open();
              }}
              type="button"
            >
              <MiniOrb size={28} />
              Talk to Mereka
            </button>
          </nav>
        </div>
      ) : null}
    </>
  );
}

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
        voice.open(undefined, { autoStart: true });
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
          "fixed left-0 right-0 top-0 z-40 flex items-center justify-between gap-4 px-5 py-4 transition duration-300 md:px-9",
          scrolled ? "bg-mk-off-black/82 text-white shadow-2xl backdrop-blur-xl" : "text-mk-off-black",
        )}
      >
        <a className="flex items-center gap-3 text-sm font-semibold tracking-[0.18em]" href="#top">
          <Image
            alt="Mereka"
            className="h-5 w-auto"
            height={26}
            src={scrolled ? "/assets/mereka-white.png" : "/assets/mereka-black.png"}
            width={112}
          />
          <span className={cn(scrolled ? "text-white/48" : "text-mk-anchor-blue/42")}>×</span>
          <span>ORIENTAL</span>
        </a>
        <nav
          aria-label="Section menu"
          className={cn(
            "hidden items-center gap-6 text-xs font-medium uppercase tracking-[0.12em] lg:flex",
            scrolled ? "text-white/62" : "text-mk-off-black/62",
          )}
        >
          {navItems.map(([id, label]) => (
            <a
              className={cn(
                "site-nav__link relative transition",
                scrolled ? "hover:text-white" : "hover:text-mk-anchor-blue",
                activeSection === id &&
                  (scrolled ? "site-nav__link--active text-white" : "site-nav__link--active text-mk-anchor-blue"),
              )}
              href={`#${id}`}
              key={id}
            >
              {label}
            </a>
          ))}
          <a
            className={cn(
              "site-nav__link relative transition",
              scrolled ? "hover:text-white" : "hover:text-mk-anchor-blue",
            )}
            href="/faq"
          >
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <button
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={cn(
              "rounded-full px-3 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase backdrop-blur transition lg:hidden",
              scrolled
                ? "border border-white/16 bg-white/10 text-white hover:bg-white/18"
                : "border border-mk-anchor-blue/18 bg-white/70 text-mk-anchor-blue shadow-sm hover:bg-mk-anchor-blue/8",
            )}
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
          <button
            aria-label="Talk to Mereka"
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] backdrop-blur transition",
              scrolled
                ? "border border-white/16 bg-white/10 text-white hover:bg-white/18"
                : "border border-mk-anchor-blue/18 bg-white/70 text-mk-anchor-blue shadow-sm hover:bg-mk-anchor-blue/8",
            )}
            onClick={() => voice.open(undefined, { autoStart: true })}
            onFocus={voice.prewarm}
            onPointerEnter={voice.prewarm}
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
            <a className="site-nav__mobile-link" href="/faq" onClick={closeMenu}>
              FAQ
            </a>
            <button
              className="site-nav__mobile-voice"
              onClick={() => {
                closeMenu();
                voice.open(undefined, { autoStart: true });
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

"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useVoice } from "@/components/voice-agent/voice-state";
import { navItems } from "@/lib/content";
import { cn } from "@/lib/utils";

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const voice = useVoice();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        voice.open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [voice]);

  return (
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
          <a className="transition hover:text-white" href={`#${id}`} key={id}>
            {label}
          </a>
        ))}
      </nav>
      <button
        className="flex items-center gap-2 rounded-full border border-white/16 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] backdrop-blur transition hover:bg-white/18"
        onClick={() => voice.open()}
        type="button"
      >
        <MiniOrb size={24} />
        <span className="hidden sm:inline">Talk to Mereka</span>
      </button>
    </header>
  );
}

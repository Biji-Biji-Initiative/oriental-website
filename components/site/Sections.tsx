import Image from "next/image";
import { EcosystemGrid } from "@/components/site/EcosystemGrid";
import { FacilitiesBands } from "@/components/site/FacilitiesBands";
import { PartnersBands } from "@/components/site/PartnersBands";
import { HeroEmailCapture } from "@/components/voice-agent/HeroEmailCapture";
import { VoiceButton } from "@/components/voice-agent/VoiceButton";
import { siteMeta } from "@/lib/content";
import { cn } from "@/lib/utils";

const footerPartners = [
  {
    name: "Mereka",
    detail: "Talent development & creative education ecosystem",
    logo: "/assets/mereka-symbol-white.png",
    logoClassName: "size-7",
  },
  {
    name: "Biji-biji Initiative",
    detail: "Social impact & innovation",
    logo: "/assets/brand/biji-biji/biji-biji-logo-white.svg",
    logoClassName: "size-8",
  },
] as const;

export function Hero() {
  return (
    <section
      className="hero-section relative grid overflow-hidden bg-mk-paper text-mk-off-black"
      data-screen-label="01 Hero"
      id="top"
    >
      <Image
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[58%_center] opacity-[0.48] mix-blend-multiply saturate-[0.65] md:object-[62%_center]"
        fill
        priority
        sizes="100vw"
        src="/assets/hero/oriental-building-blueprint.jpeg"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(244,241,234,0.97),rgba(244,241,234,0.86)_42%,rgba(244,241,234,0.5)_72%,rgba(244,241,234,0.78))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_38%,rgba(31,63,124,0.16),transparent_43%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(31,63,124,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(31,63,124,0.055)_1px,transparent_1px)] bg-[size:72px_72px] opacity-80" />
      <div className="hero-shell relative z-10 mx-auto flex w-full max-w-wrap items-center px-gutter">
        <div className="hero-copy">
          <p className="hero-tagline">A future we build together</p>
          <h1 className="hero-title">
            <span className="block">Reimagining Oriental Building</span>
          </h1>
          <p className="hero-lede">
            Mereka, Biji-biji Initiative, and partners are shaping Levels 2 to 4 of Oriental Building into a shared hub
            for future learning, technology, creativity, culture, and community — in the heart of Kuala Lumpur.
          </p>
          <div className="hero-actions">
            <VoiceButton autoStart={false} className="hero-voice-button" prefill={{ mode: "form" }}>
              <span className="min-w-0">
                Tell us why you&apos;re here
                <span className="block text-xs font-normal text-mk-off-black/58">
                  Type your interest — voice is optional inside
                </span>
              </span>
              <span className="hero-voice-button__key">SPACE</span>
            </VoiceButton>
            <HeroEmailCapture />
          </div>
          <div className="hero-private">
            <span className="size-1.5 shrink-0 rounded-full bg-mk-horizon" />
            <span>
              Private · transcribed and saved so the right person follows up · routed only to your partner&apos;s team
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Vision() {
  return (
    <section className="bg-mk-paper py-section" data-screen-label="02 Vision" id="vision">
      <div className="mx-auto max-w-wrap px-gutter">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.35fr]">
          <div>
            <span className="section-num">
              <span className="bar" />
              02 — The Vision
            </span>
            <h2 className="section-heading">
              A new chapter <em>for a historic building.</em>
            </h2>
            <p className="mt-14 text-sm uppercase tracking-[0.14em] text-mk-off-black/60">
              Levels 2 — 4 · Reactivation begins 2026
            </p>
          </div>
          <div className="space-y-6 text-lg leading-8 text-mk-off-black/74">
            <p className="text-2xl leading-10 text-mk-off-black">
              For years, Mereka has brought creators, innovators, communities, and changemakers together through
              programmes rooted in creativity, technology, collaboration, and social impact. Now, that work is entering
              a new chapter.
            </p>
            <p>
              The vision is to reactivate Levels 2 to 4 of Oriental Building as a city-centre platform for future
              education, public programmes, technology showcases, and community engagement.
            </p>
            <p className="font-serif text-2xl font-light italic text-mk-anchor-blue">
              A place where people, ideas, and partnerships meet and become real.
            </p>
          </div>
        </div>
        <figure className="relative mt-20 h-[420px] overflow-hidden rounded-lg shadow-[0_24px_80px_rgba(16,13,24,0.12)] sm:h-[560px] lg:h-[720px] lg:max-h-[78vh]">
          <Image
            alt="Oriental Building context on Jalan Tun Perak"
            className="object-cover object-[50%_22%]"
            fill
            sizes="(max-width: 768px) 100vw, 1240px"
            src="/assets/07-building-context.jpg"
          />
          <figcaption className="absolute bottom-0 left-0 right-0 flex flex-col gap-1 bg-mk-off-black/82 px-5 py-4 text-sm text-white backdrop-blur sm:flex-row sm:justify-between">
            <span>Oriental Building</span>
            <span className="text-white/56">Art Deco landmark · Jalan Tun Perak · Kuala Lumpur</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

export function Ecosystem() {
  return (
    <section className="bg-mk-off-black py-section text-white" data-screen-label="03 Ecosystem" id="ecosystem">
      <div className="mx-auto max-w-wrap px-gutter">
        <span className="section-num text-white/55">
          <span className="bar" />
          03 — The Ecosystem
        </span>
        <EcosystemGrid />
      </div>
    </section>
  );
}

export function Facilities() {
  return (
    <section className="bg-mk-paper py-section" data-screen-label="04 Spaces" id="facilities">
      <div className="mx-auto max-w-wrap px-gutter">
        <span className="section-num">
          <span className="bar" />
          04 — Community & Content Pillars
        </span>
        <h2 className="section-heading max-w-5xl">
          Built for communities that <em>should meet more often.</em>
        </h2>
        <p className="facilities-lede">
          Oriental Building is envisioned as a shared platform where different communities can learn from each other,
          build together, and access new opportunities in the heart of Kuala Lumpur.
        </p>

        <FacilitiesBands />
      </div>
    </section>
  );
}

export function Partners() {
  return (
    <section className="bg-mk-off-black py-section text-white" data-screen-label="05 Partners" id="partners">
      <div className="mx-auto max-w-wrap px-gutter">
        <span className="section-num text-white/55">
          <span className="bar" />
          05 — Call for Partners & Tenants
        </span>
        <h2 className="section-heading text-white">
          Let&apos;s build this <em>together.</em>
        </h2>
        <p className="partners-lede">
          We are looking for partners who want to help shape the building before it opens — not only occupy it after it
          is ready.
        </p>
        <PartnersBands />
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <section
      className="relative overflow-hidden bg-mk-off-black py-section text-white"
      data-screen-label="07 Closing"
      id="closing"
    >
      <Image
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-42"
        fill
        sizes="100vw"
        src="/assets/closing-community-gathering.jpg"
      />
      <div className="absolute inset-0 bg-mk-off-black/70" />
      <div className="relative mx-auto max-w-wrap px-gutter">
        <span className="section-num text-white/55">
          <span className="bar" />
          Final — More Than a Move
        </span>
        <h2 className="section-heading text-white">
          More <em>than</em>
          <br />a move.
        </h2>
        <p className="mt-8 max-w-3xl text-lg leading-8 text-white/70">
          Mereka is not just changing address. Together with Biji-biji Initiative and partners, we are shaping a new
          public-facing home for future education in Kuala Lumpur — one that connects heritage, learning, technology,
          creativity, and community under one roof.
        </p>
        <p className="mt-8 max-w-3xl font-serif text-3xl font-light italic leading-tight text-mk-horizon">
          If you have a programme, space, technology, community, institution, or idea that belongs in this story — now
          is the moment to enter the conversation.
        </p>
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <VoiceButton autoStart={false} prefill={{ mode: "form" }}>
            Start the conversation
          </VoiceButton>
          <a
            className="inline-flex min-h-12 items-center rounded-full border border-white/18 px-5 py-3 text-sm font-semibold text-white/72 transition hover:border-mk-horizon hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon"
            href="/faq"
          >
            Read the partner FAQ first
            <span aria-hidden className="ml-3 text-mk-horizon">
              →
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="bg-mk-off-black text-white">
      <div className="mx-auto max-w-wrap border-t border-white/10 px-gutter py-16">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/55">
              <span className="size-1.5 rounded-full bg-mk-horizon" />
              Get in touch
            </div>
            <h2 className="text-5xl font-semibold leading-none">
              Let&apos;s build this <em className="font-serif font-light italic text-mk-horizon">together.</em>
            </h2>
            <p className="mt-6 max-w-xl leading-7 text-white/58">
              A historic Kuala Lumpur landmark, reactivated as a home for future learning, technology, creativity, and
              community.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-mk-off-black"
                href={`mailto:${siteMeta.email}`}
              >
                Email · {siteMeta.email}
              </a>
              <VoiceButton
                autoStart={false}
                className="bg-white/10 text-white hover:bg-white hover:text-mk-off-black"
                prefill={{ mode: "form" }}
              >
                Or · Talk to Mereka
              </VoiceButton>
            </div>
            <a
              className="mt-5 inline-block text-sm text-white/58 underline-offset-4 transition hover:text-white hover:underline"
              href="/faq"
            >
              Read the partner & tenant FAQ →
            </a>
          </div>
          <div>
            <div className="footer-tag">Location</div>
            <a
              className="mt-4 block leading-7 text-white/70 transition hover:text-white"
              href="https://www.google.com/maps/search/?api=1&query=Oriental+Building+32+Jalan+Tun+Perak+Kuala+Lumpur"
              rel="noopener"
              target="_blank"
            >
              Oriental Building
              <br />
              No. 32, Jalan Tun Perak
              <br />
              50050 Kuala Lumpur
              <br />
              Malaysia ↗
            </a>
          </div>
          <div>
            <div className="footer-tag">An initiative by</div>
            <ul className="footer-brand-list">
              {footerPartners.map((partner) => (
                <li className="footer-brand-card" key={partner.name}>
                  <span className="footer-brand-mark">
                    <Image
                      alt=""
                      aria-hidden
                      className={cn("object-contain", partner.logoClassName)}
                      height={40}
                      src={partner.logo}
                      unoptimized
                      width={40}
                    />
                  </span>
                  <span>
                    <span className="footer-brand-name">{partner.name}</span>
                    <span className="footer-brand-detail">{partner.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-14 flex flex-col justify-between gap-4 border-t border-white/10 pt-6 text-sm text-white/55 md:flex-row">
          <span>© 2026 · Mereka × Biji-biji Initiative</span>
          <span>Oriental Building · A new chapter for a historic Kuala Lumpur landmark</span>
        </div>
      </div>
    </footer>
  );
}

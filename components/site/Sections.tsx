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
  {
    name: "CIMB",
    detail: "Strategic partner",
    logo: "/assets/brand/cimb/cimb-symbol.svg",
    logoClassName: "size-8",
  },
] as const;

export function Hero() {
  return (
    <section
      className="relative grid min-h-svh overflow-hidden bg-mk-off-black text-white"
      data-screen-label="01 Hero"
      id="top"
    >
      <Image
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        fill
        priority
        sizes="100vw"
        src="/assets/orientalhero2.png"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,13,24,0.78),rgba(16,13,24,0.28)_52%,rgba(16,13,24,0.7))]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30" />
      <HeroCorner className="left-5 top-24 md:left-9" lines={["Oriental Building", "Jalan Tun Perak · Kuala Lumpur"]} />
      <HeroCorner className="right-5 top-24 text-right md:right-9" lines={["Levels Two–Four", "Opening 2027"]} />
      <HeroCorner className="bottom-10 left-5 md:left-9" lines={["Status", "Partner conversations now open"]} />
      <HeroCorner
        className="bottom-10 right-5 text-right md:right-9"
        lines={["oriental.mereka.io", "A founding invitation"]}
      />
      <div className="relative z-10 mx-auto flex w-full max-w-wrap items-center px-gutter py-32">
        <div className="max-w-5xl">
          <div className="mb-6 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.16em] text-white/70">
            <span className="size-2 rounded-full bg-mk-horizon" />A new chapter for a historic building
          </div>
          <h1 className="text-[clamp(54px,9vw,148px)] font-extrabold leading-[0.91] tracking-normal">
            Reimagining
            <br />
            <span className="text-transparent [-webkit-text-stroke:1.2px_rgba(255,255,255,0.72)]">Oriental.</span>
            <br />
            <em className="font-serif font-light">A future</em> we build together.
          </h1>
          <p className="mt-8 max-w-3xl text-lg leading-8 text-white/78 md:text-xl">
            Mereka, Biji-biji Initiative, CIMB, and partners are shaping Levels 2 to 4 of Oriental Building into a
            shared hub for future learning, technology, creativity, culture, and community — in the heart of Kuala
            Lumpur.
          </p>
          <div className="mt-9 flex flex-col gap-5">
            <VoiceButton className="w-fit">
              <span>
                Tell us why you&apos;re here
                <span className="block text-xs font-normal text-mk-off-black/58">
                  Speak or type — Mereka will route you to the right team
                </span>
              </span>
              <span className="rounded-full bg-mk-off-black px-2 py-1 text-[10px] text-white">SPACE</span>
            </VoiceButton>
            <HeroEmailCapture />
          </div>
          <div className="mt-5 flex items-center gap-2 text-sm text-white/62">
            <span className="size-1.5 rounded-full bg-mk-horizon" />
            End-to-end · private · no recordings kept · routed only to your partner&apos;s team at Mereka
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroCorner({ className, lines }: { className?: string; lines: [string, string] }) {
  return (
    <div className={cn("absolute z-10 hidden text-xs uppercase tracking-[0.15em] text-white/68 md:block", className)}>
      <div className="text-white">{lines[0]}</div>
      <div className="mt-1 text-white/48">{lines[1]}</div>
    </div>
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
            <p className="mt-14 text-sm uppercase tracking-[0.14em] text-mk-off-black/45">
              Levels 2 — 4 · Reactivation begins 2026
            </p>
          </div>
          <div className="space-y-6 text-lg leading-8 text-mk-off-black/74">
            <p className="text-2xl leading-10 text-mk-off-black">
              For years, Mereka has brought communities, educators, creators, organisations, and changemakers together
              through programmes rooted in creativity, collaboration, learning, and social impact. Now, that work is
              entering a new chapter.
            </p>
            <p>
              The vision is to reactivate Levels 2 to 4 of Oriental Building as a city-centre platform for future
              education, public programmes, technology showcases, creative production, and community engagement.
            </p>
            <p>
              This is not simply a relocation. It is a chance to turn heritage into active infrastructure for what Kuala
              Lumpur needs next: places to learn, make, test, gather, and collaborate across generations and
              disciplines.
            </p>
            <p className="font-serif text-2xl font-light italic text-mk-anchor-blue">
              A place where people, ideas, and partnerships do not just meet — they become real.
            </p>
          </div>
        </div>
        <figure className="relative mt-20 h-[520px] overflow-hidden rounded-[18px]">
          <Image
            alt="Oriental Building context on Jalan Tun Perak"
            className="object-cover"
            fill
            sizes="(max-width: 768px) 100vw, 1240px"
            src="/assets/07-building-context.png"
          />
          <figcaption className="absolute bottom-0 left-0 right-0 flex justify-between bg-mk-off-black/80 px-5 py-4 text-sm text-white backdrop-blur">
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
        <h2 className="section-heading max-w-5xl text-white">
          Spaces for learning, making, <em>gathering, & testing new ideas.</em>
        </h2>
        <p className="eco-lede">
          The planned ecosystem brings together flexible spaces, public programming, and partner-led activations across
          education, technology, creativity, culture, and social impact.
        </p>
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
        src="/assets/01-hero-welcome.png"
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
          Mereka is not just changing address. Together with Biji-biji Initiative, CIMB, and partners, we are shaping a
          new public-facing home for future education in Kuala Lumpur — one that connects heritage, learning,
          technology, creativity, and community under one roof.
        </p>
        <p className="mt-8 max-w-3xl font-serif text-3xl font-light italic leading-tight text-mk-horizon">
          If you have a programme, space, technology, community, institution, or idea that belongs in this story — now
          is the moment to enter the conversation.
        </p>
        <VoiceButton className="mt-10">Start the conversation</VoiceButton>
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
            <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/42">
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
              <VoiceButton className="bg-white/10 text-white hover:bg-white hover:text-mk-off-black">
                Or · Talk to Mereka
              </VoiceButton>
            </div>
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
        <div className="mt-14 flex flex-col justify-between gap-4 border-t border-white/10 pt-6 text-sm text-white/42 md:flex-row">
          <span>© 2026 · Mereka × Biji-biji Initiative × CIMB</span>
          <span>Oriental Building · A new chapter for a historic Kuala Lumpur landmark</span>
        </div>
      </div>
    </footer>
  );
}

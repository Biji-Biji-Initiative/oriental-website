import { Closing, Ecosystem, Facilities, Footer, Hero, Partners, Vision } from "@/components/site/Sections";
import { Timeline } from "@/components/site/Timeline";
import { siteMeta } from "@/lib/content";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Mereka",
        url: "https://corporate.mereka.io",
        email: siteMeta.email,
      },
      {
        "@type": "Place",
        name: "Oriental Building",
        address: "No. 32, Jalan Tun Perak, 50050 Kuala Lumpur, Malaysia",
        geo: { "@type": "GeoCoordinates", latitude: 3.1473, longitude: 101.6979 },
      },
    ],
  };

  return (
    <main>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from local constants. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Hero />
      <Vision />
      <Ecosystem />
      <Facilities />
      <Partners />
      <Timeline />
      <Closing />
      <Footer />
    </main>
  );
}

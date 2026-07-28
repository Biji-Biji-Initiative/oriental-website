import { Closing, Ecosystem, Facilities, Footer, Hero, Partners, Vision } from "@/components/site/Sections";
import { Timeline } from "@/components/site/Timeline";
import { siteMeta } from "@/lib/content";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteMeta.url}#website`,
        name: "Oriental Building",
        url: siteMeta.url,
        description: siteMeta.description,
        publisher: { "@id": `${siteMeta.url}#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${siteMeta.url}#organization`,
        name: "Mereka",
        url: "https://corporate.mereka.io",
        email: siteMeta.email,
        logo: `${siteMeta.url}/assets/brand/mereka/favicon-256x256.png`,
        sameAs: ["https://corporate.mereka.io", "https://www.bebiji.com"],
      },
      {
        "@type": "Place",
        "@id": `${siteMeta.url}#place`,
        name: "Oriental Building",
        url: siteMeta.url,
        address: {
          "@type": "PostalAddress",
          streetAddress: "No. 32, Jalan Tun Perak",
          addressLocality: "Kuala Lumpur",
          postalCode: "50050",
          addressCountry: "MY",
        },
        geo: { "@type": "GeoCoordinates", latitude: 3.1473, longitude: 101.6979 },
      },
    ],
  };

  return (
    <main id="main-content">
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

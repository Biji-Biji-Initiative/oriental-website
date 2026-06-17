import type { Metadata } from "next";
import Link from "next/link";
import { faqItemPlainText, faqSections } from "@/lib/faq-content";

export const metadata: Metadata = {
  title: "FAQ · Oriental Building Call for Partners & Tenants",
  description:
    "Answers about the Oriental Building project — the space and vision, who we are looking for, space options and pricing on Level 3, programmes, and how to express your interest.",
  alternates: { canonical: "/faq" },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqSections.flatMap((section) =>
    section.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: faqItemPlainText(item) },
    })),
  ),
};

export default function FaqPage() {
  return (
    <main className="bg-mk-paper text-mk-off-black" id="main-content">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from local constants. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <section className="py-section">
        <div className="mx-auto max-w-wrap px-gutter">
          <span className="section-num">
            <span className="bar" />
            Oriental Building · Call for Partners & Tenants
          </span>
          <h1 className="section-heading max-w-4xl">
            Frequently asked <em>questions.</em>
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-8 text-mk-off-black/70">
            Everything you might want to know about the space, who we are looking for, options and pricing, and how to
            express your interest. Still unsure?{" "}
            <Link className="font-semibold text-mk-anchor-blue underline-offset-4 hover:underline" href="/#partners">
              Start a conversation with us.
            </Link>
          </p>

          <div className="mt-16 space-y-16">
            {faqSections.map((section) => (
              <section aria-labelledby={`faq-${section.id}`} key={section.id}>
                <h2
                  className="text-xs font-semibold uppercase tracking-[0.18em] text-mk-anchor-blue"
                  id={`faq-${section.id}`}
                >
                  {section.title}
                </h2>
                <div className="mt-6 divide-y divide-mk-off-black/10 border-y border-mk-off-black/10">
                  {section.items.map((item) => (
                    <details className="faq-item group" key={item.q}>
                      <summary className="faq-item__summary">
                        <span>{item.q}</span>
                        <span aria-hidden className="faq-item__icon">
                          +
                        </span>
                      </summary>
                      <div className="faq-item__body">
                        {item.a.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                        {item.bullets ? (
                          <ul>
                            {item.bullets.map((bullet) => (
                              <li key={bullet}>{bullet}</li>
                            ))}
                          </ul>
                        ) : null}
                        {item.table ? (
                          <div className="faq-item__table">
                            <table>
                              <thead>
                                <tr>
                                  <th scope="col">{item.table.head[0]}</th>
                                  <th scope="col">{item.table.head[1]}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {item.table.rows.map((row) => (
                                  <tr key={row[0]}>
                                    <th scope="row">{row[0]}</th>
                                    <td>{row[1]}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        {item.note ? <p className="faq-item__note">{item.note}</p> : null}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-16 text-sm text-mk-off-black/50">Last updated: May 2026 · Mereka & Biji-biji Initiative</p>
        </div>
      </section>
    </main>
  );
}

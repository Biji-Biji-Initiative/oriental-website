import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FAQ · Oriental Building Call for Partners & Tenants",
  description:
    "Answers about the Oriental Building project — the space and vision, who we are looking for, space options and pricing on Level 3, programmes, and how to express your interest.",
  alternates: { canonical: "/faq" },
};

type FaqItem = {
  q: string;
  a: string[];
  bullets?: string[];
  table?: { head: [string, string]; rows: Array<[string, string]> };
  note?: string;
};

type FaqSection = {
  id: string;
  title: string;
  items: FaqItem[];
};

const faqSections: FaqSection[] = [
  {
    id: "about",
    title: "About the space & vision",
    items: [
      {
        q: "What is the Oriental Building project?",
        a: [
          "Mereka and the Biji-biji Initiative are transforming Levels 2 to 4 of the Oriental Building in Kuala Lumpur into a future-focused hub for education, creativity, technology, culture, and community engagement. More than a shared workspace, it is designed as a living ecosystem where people, programmes, and partnerships come together to shape what's next.",
        ],
      },
      {
        q: "Which floors are involved, and what will they contain?",
        a: ["Levels 2 to 4 are being reimagined. The planned spaces include:"],
        bullets: [
          "Public commons & community lounge: open gathering and networking space",
          "Applied workshops: flexible classrooms and workshop rooms",
          "Flexible event spaces: modular venue for talks, forums, screenings, and public discussions",
          "Social enterprise & innovation spaces: co-working and incubation for impact-driven organisations",
        ],
      },
      {
        q: "Is this confirmed, or is it still a concept?",
        a: [
          "The vision is confirmed, and the planning phase is actively underway in 2026. Renovation and activation are targeted for 2026–2027, with a full opening and programme launch planned for 2027. Expressions of interest submitted now directly influence the final spatial design and programming direction.",
        ],
      },
    ],
  },
  {
    id: "who",
    title: "Who we're looking for",
    items: [
      {
        q: "What are the partner and tenant types you're looking for?",
        a: ["We are building this ecosystem with three core types of organisations in mind:"],
        bullets: [
          "Mission-Aligned Tenants — organisations, studios, social enterprises, and community-driven brands looking for a collaborative space to grow, connect, and contribute to a vibrant public ecosystem.",
          "Education & Programme Partners — academic institutions, social enterprises, and learning operators, including teams running recurring workshops, trainings, or skilling programmes, who want to deliver impact-driven programmes in a professional, ready-to-use collaborative environment.",
          "Technology & Innovation Partners — companies and platform providers looking to showcase tools, technologies, and hands-on learning experiences through demos, activations, and embedded programmes.",
        ],
      },
      {
        q: "What does a mission-aligned tenant look like?",
        a: [
          "A mission-aligned tenant is an organisation whose work naturally contributes to the ecosystem's goals around learning, community, creativity, or social impact. This includes social enterprises, NGOs, creative studios, community-driven brands, and purpose-led organisations of any size. If your day-to-day work touches people, ideas, or community, you likely belong here.",
        ],
      },
      {
        q: "What counts as an education or programme partner?",
        a: ["This category brings together two complementary types of organisations:"],
        bullets: [
          "Education partners: academic institutions, capacity-building organisations, and social enterprises delivering structured learning or community programmes in a collaborative space.",
          "Programme and learning operators: teams running recurring workshops, training, and skilling programmes who need a professional, ready-to-use environment without managing their own venue.",
        ],
        note: "Whether you run a 6-month bootcamp, weekly community workshops, or professional upskilling sessions, this is designed for you.",
      },
      {
        q: "What does a technology or innovation partner do here?",
        a: [
          "Technology and innovation partners use the building as a platform to bring their tools and technologies closer to the communities they serve. This could take the form of product demos, hands-on learning activations, embedded programmes, or showcase installations within the ecosystem's public and programme spaces. If your organisation has something to show, teach, or co-create with a public audience, this is your space.",
        ],
      },
      {
        q: "What communities does the building aim to serve?",
        a: ["The ecosystem is designed to serve an inclusive community:"],
        bullets: [
          "Students and Youths",
          "Impact Organisations",
          "Working Professionals",
          "Creative Community",
          "Entrepreneurs and SMEs",
          "Community Groups and Seniors",
        ],
      },
    ],
  },
  {
    id: "pricing",
    title: "Space options & pricing",
    items: [
      {
        q: "What office sizes are available on the 3rd floor?",
        a: ["Four office configurations are available:"],
        table: {
          head: ["Type", "Size"],
          rows: [
            ["Type A", "250–300 sq ft"],
            ["Type B", "400–600 sq ft"],
            ["Type C", "700–800 sq ft"],
            ["Full floor", "~2,800 sq ft"],
          ],
        },
        note: "Unit conditions vary depending on floor suitability and partner needs — we have a mix of ready-to-move-in and bare units available. For bare units, fit-out, furnishing, and utilities are the tenant's responsibility. A 2-month deposit is required to secure your space.",
      },
      {
        q: "What does “bare unit” mean? What is and isn't included?",
        a: ["A bare unit means the space is handed over in its base condition. It does not include:"],
        bullets: [
          "Furniture or workstations",
          "Partitioning or internal fit-out",
          "Internet or telecommunications setup",
          "Air-conditioning units (to be confirmed per unit)",
          "Signage",
        ],
        note: "Tenants are fully responsible for fitting out their space, which gives you complete flexibility to design it around your brand and workflow. Need help with fit-out planning or contractor referrals? Let us know in your expression of interest and we'll do our best to help.",
      },
      {
        q: "How do I know which size is right for my team?",
        a: ["As a rough guide based on a standard open-plan layout:"],
        bullets: [
          "Type A (~300 sq ft): suits a small team of 2–4, or a solo operator needing a private dedicated office.",
          "Type B (~500 sq ft): suitable for 5–8 people, comfortably fits a small meeting area.",
          "Type C (~800 sq ft): ideal for 10–14 people or organisations needing space for daily operations plus in-office gatherings.",
        ],
        note: "Final usable capacity will depend on your fit-out. Share your team size and setup in the expression of interest form and we'll advise accordingly.",
      },
      {
        q: "Is the full floor available as a single rental option?",
        a: [
          "Yes. A full-floor option of approximately 2,800 sq ft is available for anchor tenants or established organisations that want a larger, contiguous space with dedicated floor presence within the ecosystem. Reach out to us directly to discuss full-floor arrangements.",
        ],
      },
    ],
  },
  {
    id: "programmes",
    title: "Programmes & collaboration",
    items: [
      {
        q: "Can I run my own programmes or workshops in the space?",
        a: [
          "Yes, this is actively encouraged. The building is designed to host recurring workshops, training programmes, community events, cultural activations, and public discussions. Whether you run regular courses or periodic community events, the ecosystem can accommodate your programming needs.",
        ],
      },
      {
        q: "How does collaboration between tenants work?",
        a: [
          "Collaboration is built into the ecosystem by design. Tenants and partners are encouraged to co-create public workshops, share resources, cross-promote programmes, offer mentorship, and explore joint initiatives with Mereka, Biji-biji, and each other. The community lounge and shared spaces are specifically designed to facilitate both spontaneous and structured collaboration.",
        ],
      },
    ],
  },
  {
    id: "process",
    title: "Process & next steps",
    items: [
      {
        q: "When can we move in?",
        a: [
          "The target opening is January 2027, following renovation and activation works planned throughout 2026–2027. Submitting your expression of interest now helps shape the build-out and secures your place in the allocation process ahead of opening.",
        ],
      },
      {
        q: "How do we express our interest?",
        a: [
          "Fill in the expression of interest form on this page. It covers your organisation type, space requirements, operating needs, budget range, and how you see yourself contributing to the ecosystem. Our team will follow up after reviewing your submission.",
        ],
      },
      {
        q: "What happens after we submit the form?",
        a: ["After submission, you can expect:"],
        bullets: [
          "A follow-up from our team to learn more about your organisation and goals.",
          "A discovery conversation to explore fit and available space configurations.",
          "A co-developed tenancy or partnership proposal aligned to the 2027 opening.",
        ],
        note: "Early expressions of interest have the most influence on how the space is designed and allocated.",
      },
      {
        q: "We're not sure if we're the right fit — should we still reach out?",
        a: [
          "Absolutely. If you are drawn to the vision and believe your organisation could contribute to or benefit from this kind of ecosystem, submit your interest and let us know you'd like guidance — our team will help you explore what a collaboration could look like.",
        ],
      },
    ],
  },
];

function faqItemPlainText(item: FaqItem) {
  return [...item.a, ...(item.bullets ?? []), item.note ?? ""].filter(Boolean).join(" ");
}

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

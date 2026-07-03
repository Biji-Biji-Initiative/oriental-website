export type FaqItem = {
  q: string;
  a: string[];
  bullets?: string[];
  table?: { head: [string, string]; rows: Array<[string, string]> };
  note?: string;
};

export type FaqSection = {
  id: string;
  title: string;
  items: FaqItem[];
};

export const faqSections: FaqSection[] = [
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
          "Academy of Tomorrow learning studios: flexible classrooms and workshop rooms",
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
        q: "What types of partners and tenants are you looking for?",
        a: ["We are building this ecosystem with four core types of organisations in mind:"],
        bullets: [
          "Mission-Aligned Tenants — organisations, studios, social enterprises, and community-driven brands looking for a collaborative space to grow, connect, and contribute to a vibrant public ecosystem.",
          "Education & Programme Partners — academic institutions, social enterprises, and learning operators, including teams running recurring workshops, trainings, or skilling programmes, who want to deliver impact-driven programmes in a professional, ready-to-use collaborative environment.",
          "Technology & Innovation Partners — companies and platform providers looking to showcase tools, technologies, and hands-on learning experiences through demos, activations, and embedded programmes.",
          "Community & Cultural Partners — community organisations, cultural practitioners, creative collectives, facilitators, and civic groups looking for a meaningful space to gather, teach, exhibit, perform, or co-create.",
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
          "Creative Community",
          "Corporate Partners",
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
            ["Full floor", "~2,800–3,000 sq ft"],
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
          "Yes. A full-floor option of approximately 2,800–3,000 sq ft is available for anchor tenants or established organisations that want a larger, contiguous space with dedicated floor presence within the ecosystem. Reach out to us directly to discuss full-floor arrangements.",
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
          "Start a conversation from any Talk to Mereka CTA or expression of interest flow on the homepage. It covers your organisation type, space requirements, operating needs, budget range, and how you see yourself contributing to the ecosystem. Our team will follow up after reviewing your submission.",
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

export function faqItemPlainText(item: FaqItem) {
  const tableRows = item.table?.rows.map(([type, size]) => `${type}: ${size}`) ?? [];
  return [...item.a, ...(item.bullets ?? []), ...tableRows, item.note ?? ""].filter(Boolean).join(" ");
}

export function faqKnowledgeLines() {
  return faqSections.flatMap((section) => [
    `FAQ section: ${section.title}`,
    ...section.items.map((item) => `${item.q} ${faqItemPlainText(item)}`),
  ]);
}

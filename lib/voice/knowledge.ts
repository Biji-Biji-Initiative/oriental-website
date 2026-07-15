import { audiences, ecosystemCells, partners, pillars, spaces, timelineSteps } from "@/lib/content";
import { faqItemPlainText, faqSections } from "@/lib/faq-content";

export const ORIENTAL_KNOWLEDGE_TOPICS = [
  "general",
  "spaces",
  "partners",
  "pricing",
  "programmes",
  "timeline",
  "process",
] as const;

export type OrientalKnowledgeTopic = (typeof ORIENTAL_KNOWLEDGE_TOPICS)[number];

type KnowledgeRecord = {
  topic: OrientalKnowledgeTopic;
  title: string;
  text: string;
};

const records: KnowledgeRecord[] = [
  {
    topic: "general",
    title: "Oriental Building vision",
    text: "Mereka and Biji-biji Initiative are shaping Levels 2 to 4 as a Kuala Lumpur hub for future learning, technology, creativity, culture, and community, with operations planned from January 2027.",
  },
  ...spaces.map((space) => ({ topic: "spaces" as const, title: space.title, text: space.description })),
  ...partners.map((partner) => ({ topic: "partners" as const, title: partner.title, text: partner.description })),
  ...ecosystemCells.map((cell) => ({ topic: "programmes" as const, title: cell.title, text: cell.description })),
  ...pillars.map((pillar) => ({ topic: "programmes" as const, title: pillar.name, text: pillar.description })),
  {
    topic: "partners",
    title: "Communities served",
    text: audiences.join(", "),
  },
  ...timelineSteps.map((step) => ({ topic: "timeline" as const, title: step.phase, text: step.timeline })),
  ...faqSections.flatMap((section) =>
    section.items.map((item) => ({
      topic: faqTopic(section.id),
      title: item.q,
      text: faqItemPlainText(item),
    })),
  ),
];

export function lookupOrientalKnowledge(input: { topic?: unknown; query?: unknown }) {
  const topic = isTopic(input.topic) ? input.topic : "general";
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 240) : "";
  const terms = tokenize(query);
  const candidates = topic === "general" ? records : records.filter((record) => record.topic === topic);
  const ranked = candidates
    .map((record) => ({ record, score: scoreRecord(record, terms) }))
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.record.title.localeCompare(right.record.title))
    .slice(0, 3)
    .map(({ record }) => ({ title: record.title, answer: record.text }));

  return {
    ok: true,
    topic,
    query,
    matches: ranked,
    ...(ranked.length === 0 ? { guidance: "No matching published fact. Capture the question for the team." } : {}),
  };
}

function isTopic(value: unknown): value is OrientalKnowledgeTopic {
  return typeof value === "string" && ORIENTAL_KNOWLEDGE_TOPICS.includes(value as OrientalKnowledgeTopic);
}

function faqTopic(sectionId: string): OrientalKnowledgeTopic {
  if (sectionId === "pricing") return "pricing";
  if (sectionId === "programmes") return "programmes";
  if (sectionId === "process") return "process";
  if (sectionId === "who") return "partners";
  return "general";
}

function tokenize(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((term) => term.length > 1);
}

function scoreRecord(record: KnowledgeRecord, terms: string[]) {
  if (terms.length === 0) return 1;
  const title = record.title.toLowerCase();
  const body = record.text.toLowerCase();
  return terms.reduce((score, term) => score + (title.includes(term) ? 4 : 0) + (body.includes(term) ? 1 : 0), 0);
}

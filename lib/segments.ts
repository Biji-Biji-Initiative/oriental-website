export const SEGMENT_IDS = [
  "tenancy",
  "education",
  "programme",
  "technology",
  "ai",
  "cultural",
  "community",
  "other",
] as const;

export type SegmentId = (typeof SEGMENT_IDS)[number];

export type Segment = {
  id: SegmentId;
  label: string;
  blurb: string;
  prompt: string;
  voiceOpener: string;
  routedTo: {
    name: string;
    role: string;
    hue: number;
  };
};

export const SEGMENTS = {
  tenancy: {
    id: "tenancy",
    label: "Tenancy",
    blurb: "Long-term space for studios & enterprises",
    routedTo: { name: "Chewi", role: "Tenancy Lead", hue: 1 },
    prompt: "Tell us about your studio or enterprise, and the kind of space you need.",
    voiceOpener: "So, long-term space at Oriental. Tell me about your studio or enterprise.",
  },
  education: {
    id: "education",
    label: "Education",
    blurb: "Run learning programmes with us",
    routedTo: { name: "Lala", role: "Programmes Lead", hue: 2 },
    prompt: "What kind of learning programmes do you run? Who do you serve?",
    voiceOpener: "Education partnership. Tell me what kind of programmes you run.",
  },
  programme: {
    id: "programme",
    label: "Programme",
    blurb: "Bring recurring workshops & trainings",
    routedTo: { name: "Jey", role: "Programmes Lead", hue: 2 },
    prompt: "What workshops or trainings would you run here, and how often?",
    voiceOpener: "Workshops and trainings. What do you run, and how often?",
  },
  technology: {
    id: "technology",
    label: "Technology",
    blurb: "Showcase tools & embed demos",
    routedTo: { name: "Gurpreet", role: "Innovation Lead", hue: 3 },
    prompt: "What tools or technologies would you showcase? Hands-on demos?",
    voiceOpener: "Tech partnership. Tell me about the tools you would showcase.",
  },
  ai: {
    id: "ai",
    label: "AI",
    blurb: "AI labs, agents, literacy & applied research",
    routedTo: { name: "Gurpreet", role: "Innovation Lead", hue: 3 },
    prompt: "Are you bringing an AI lab, an agent product, a literacy programme, or applied research?",
    voiceOpener: "AI. Tell me what you would bring: a lab, an agent product, literacy work?",
  },
  cultural: {
    id: "cultural",
    label: "Cultural",
    blurb: "Exhibitions, residencies, performances",
    routedTo: { name: "AVI", role: "Culture Curator", hue: 4 },
    prompt: "What kind of cultural work? Exhibitions, performances, residencies?",
    voiceOpener: "Cultural work. Tell me what you would bring.",
  },
  community: {
    id: "community",
    label: "Community",
    blurb: "NGO, social impact, community-driven",
    routedTo: { name: "Ambika", role: "Community Lead", hue: 5 },
    prompt: "Tell us about your community work and the people you serve.",
    voiceOpener: "Community work. Who do you serve, and how?",
  },
  other: {
    id: "other",
    label: "Other",
    blurb: "Press, investor, or just exploring",
    routedTo: { name: "Nadia", role: "Partnerships", hue: 6 },
    prompt: "Tell us how you would like to be involved, or just say hi.",
    voiceOpener: "Tell me what brought you here today.",
  },
} satisfies Record<SegmentId, Segment>;

export function getSegment(id: string | null | undefined): Segment {
  return SEGMENTS[SEGMENT_IDS.includes(id as SegmentId) ? (id as SegmentId) : "other"];
}

export function getOwnerEmail(segmentId: SegmentId): string | null {
  const key = `OWNER_${segmentId.toUpperCase()}`;
  return process.env[key] ?? process.env.OWNER_OTHER ?? null;
}

export function segmentOptions() {
  return SEGMENT_IDS.map((id) => SEGMENTS[id]);
}

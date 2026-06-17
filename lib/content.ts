import type { SegmentId } from "@/lib/segments";

export const siteMeta = {
  title: "Oriental · A future we build together",
  description:
    "Oriental Building — a historic Kuala Lumpur landmark, reactivated as a home for future learning, technology, creativity, and community. Mereka, Biji-biji Initiative, and partners are shaping Levels 2 to 4 before the building opens in 2027.",
  url: "https://oriental.mereka.io",
  email: "team@mereka.io",
};

export const navItems = [
  ["vision", "Vision"],
  ["ecosystem", "Ecosystem"],
  ["facilities", "Spaces"],
  ["partners", "Partners"],
  ["timeline", "Timeline"],
] as const;

export const ecosystemCells = [
  {
    number: "01",
    intent: "programme" as SegmentId,
    title: "Public Programme & Event Spaces",
    description: "Talks, forums, launches, screenings, exhibitions, performances, and public conversations.",
  },
  {
    number: "02",
    intent: "technology" as SegmentId,
    title: "Technology Showcase & Demo Spaces",
    description:
      "Hands-on experiences with AI, digital tools, future skills, digital trust, and emerging technologies.",
  },
  {
    number: "03",
    intent: "education" as SegmentId,
    title: "Workshops & Future Skills Programmes",
    description:
      "Youth development, professional upskilling, entrepreneurship, creative learning, and community education.",
  },
  {
    number: "04",
    intent: "community" as SegmentId,
    title: "Innovation & Social Impact Initiatives",
    description:
      "NGOs, social enterprises, startups, and mission-driven teams building solutions with community relevance.",
  },
] as const;

export const audiences = [
  "Students and Youths",
  "Impact Organisations",
  "Working Professionals",
  "Creative Community",
  "Entrepreneurs and SMEs",
  "Community Groups and Seniors",
] as const;

export const pillars = [
  {
    name: "Future Readiness & New Economic Opportunities",
    description: "Helping people prepare for new work, new tools, and new forms of livelihood.",
    intent: "education" as SegmentId,
  },
  {
    name: "Digital Trust, AI Literacy & Inclusion",
    description: "Making technology understandable, usable, and relevant across communities.",
    intent: "technology" as SegmentId,
  },
  {
    name: "NGO & Social Enterprise Capability Building",
    description: "Strengthening the organisations working closest to social and community needs.",
    intent: "community" as SegmentId,
  },
  {
    name: "MSME & Livelihood Resilience",
    description:
      "Supporting small businesses, freelancers, and working professionals with practical skills and networks.",
    intent: "programme" as SegmentId,
  },
  {
    name: "Health, Ageing & Community Wellbeing",
    description: "Creating space for intergenerational learning, care, connection, and community participation.",
    intent: "community" as SegmentId,
  },
] as const;

export const spaces = [
  {
    number: "01",
    title: "Public Commons & Community Lounge",
    description:
      "The social heart of the building — open, welcoming, and active throughout the day. Designed for casual collaboration, exhibitions, networking, community gatherings, and the moments between programmes where new connections begin.",
    cta: "Explore the Commons",
    intent: "community" as SegmentId,
    image: "/assets/spaces/public-commons-community-lounge.jpg",
  },
  {
    number: "02",
    title: "Academy of Tomorrow Learning Studios",
    description:
      "Flexible classrooms and workshop rooms for future skills training, entrepreneurship programmes, youth development, creative learning, professional upskilling, and recurring classes.",
    cta: "Bring a Learning Programme",
    intent: "education" as SegmentId,
    image: "/assets/2026-05-04-05-academy-tomorrow-2-v2.png",
  },
  {
    number: "03",
    title: "Flexible Event Spaces",
    description:
      "Modular spaces for talks, forums, screenings, product showcases, performances, launches, exhibitions, and public discussions.",
    cta: "Host an Event or Activation",
    intent: "programme" as SegmentId,
    image: "/assets/spaces/flexible-event-spaces-forum.jpg",
  },
  {
    number: "04",
    title: "Social Enterprise & Innovation Spaces",
    description:
      "Co-working, incubation, and showcase space for impact-driven organisations, social enterprises, NGOs, startups, and mission-aligned teams building with community relevance.",
    cta: "Explore Impact Space",
    intent: "tenancy" as SegmentId,
    image: "/assets/16-buy-social-showcase.png",
  },
] as const;

export const partners = [
  {
    number: "01",
    tag: "TENANCY",
    title: "Mission-Aligned Tenants",
    description:
      "Organisations, studios, social enterprises, and community-driven brands looking for a collaborative city-centre space to grow, connect, and contribute to a wider public ecosystem.",
    cta: "Discuss Tenancy",
    intent: "tenancy" as SegmentId,
  },
  {
    number: "02",
    tag: "EDUCATION",
    title: "Education & Programme Partners",
    description:
      "Academic institutions, training providers, social enterprises, and teams running workshops, trainings, or recurring programmes who want to deliver future-facing, impact-driven learning in a professional, ready-to-use space.",
    cta: "Propose a Learning Partnership",
    intent: "education" as SegmentId,
  },
  {
    number: "03",
    tag: "TECHNOLOGY",
    title: "Technology & Innovation Partners",
    description:
      "Companies, platforms, labs, and innovation teams looking to showcase tools, run demos, support hands-on learning, or create embedded technology experiences.",
    cta: "Explore a Technology Showcase",
    intent: "technology" as SegmentId,
  },
] as const;

export const timelineSteps = [
  {
    phase: "Launch Public Partner Interest Call",
    timeline: "June – July 2026",
  },
  {
    phase: "Partnership Exploration",
    timeline: "June – Dec 2026",
  },
  {
    phase: "Renovation and Early Activation",
    timeline: "Sept – Dec 2026",
  },
  {
    phase: "Building Operations",
    timeline: "Jan 2027",
  },
] as const;

export const tourTopics = [
  {
    id: "vision",
    label: "The vision",
    blurb: "What we are building",
    script: "Levels 2 to 4 become a future-focused ecosystem: education, technology, creativity, and community.",
  },
  {
    id: "spaces",
    label: "The spaces",
    blurb: "Three floors, three rhythms",
    script: "Level 2 is public, Level 3 is learning, and Level 4 is innovation.",
  },
  {
    id: "timeline",
    label: "Timeline",
    blurb: "How we get there",
    script:
      "Partner interest opens mid-2026, partnership exploration and renovation run through the year, and building operations begin January 2027.",
  },
  {
    id: "heritage",
    label: "Heritage",
    blurb: "Why this building",
    script: "This is not a real-estate move. It is a heritage-led civic platform for what Kuala Lumpur needs next.",
  },
] as const;

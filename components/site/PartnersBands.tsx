"use client";

import { useVoice } from "@/components/voice-agent/voice-state";
import { partners } from "@/lib/content";

export function PartnersBands() {
  const voice = useVoice();

  return (
    <div className="partner-cards">
      {partners.map((partner) => (
        <button
          className="partner-card group"
          key={partner.number}
          onClick={() => voice.open(partner.intent, { autoStart: false, mode: "form", entryPoint: "partners" })}
          type="button"
        >
          <div className="partner-card__row">
            <span className="partner-card__num">{partner.number}</span>
            <span className="partner-card__tag">{partner.tag}</span>
          </div>
          <h3>{partner.title}</h3>
          <p>{partner.description}</p>
          <span className="partner-card__cta">
            {partner.cta}
            <span aria-hidden className="partner-card__arrow">
              {" "}
              →
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

"use client";

import { useVoice } from "@/components/voice-agent/voice-state";
import { partners, relevantIf } from "@/lib/content";

export function PartnersBands() {
  const voice = useVoice();

  return (
    <>
      <div className="partner-cards">
        {partners.map((partner) => (
          <button
            className="partner-card group"
            key={partner.number}
            onClick={() => voice.open(partner.intent)}
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

      <div className="partners-relevant">
        <div className="partners-relevant__head">Especially relevant if you want to</div>
        <div className="partners-relevant__body">
          <ul>
            {relevantIf.map((item) => (
              <li key={item}>
                <span aria-hidden className="partners-relevant__dot" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="partners-relevant__note">
            No polished proposal needed. Your enquiry routes to the right Mereka team. No public listing. No commitment
            required.
          </p>
        </div>
      </div>
    </>
  );
}

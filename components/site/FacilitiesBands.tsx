"use client";

import Image from "next/image";
import { useVoice } from "@/components/voice-agent/voice-state";
import { audiences, pillars, spaces } from "@/lib/content";
export function FacilitiesBands() {
  const voice = useVoice();

  return (
    <div className="facilities-v2">
      <div className="facilities-band">
        <div>
          <h3 className="facilities-band__title">Designed for</h3>
          <p className="facilities-band__copy">
            A shared platform bringing together diverse communities through accessible programming and meaningful
            engagement.
          </p>
        </div>
        <div className="facilities-aud-list">
          {audiences.map((audience, index) => (
            <button
              className="facilities-aud"
              key={audience}
              onClick={() => voice.open(undefined, { autoStart: false, mode: "form" })}
              type="button"
            >
              <span className="facilities-aud__num">{String(index + 1).padStart(2, "0")}</span>
              <span className="facilities-aud__name">{audience}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="facilities-band">
        <div>
          <h3 className="facilities-band__title">Programme pillars.</h3>
          <p className="facilities-band__copy">
            Five intersecting pillars shape the programmes the building will host.
          </p>
        </div>
        <div className="facilities-pillars">
          {pillars.map((pillar, index) => (
            <button
              className="facilities-pillar group"
              key={pillar.name}
              onClick={() => voice.open(pillar.intent, { autoStart: false, mode: "form" })}
              type="button"
            >
              <span className="facilities-pillar__num">{String(index + 1).padStart(2, "0")}</span>
              <span className="facilities-pillar__body">
                <span className="facilities-pillar__name">{pillar.name}</span>
                <span className="facilities-pillar__desc">{pillar.description}</span>
              </span>
              <span aria-hidden className="facilities-pillar__arr">
                ↗
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="facilities-spaces-band">
        <div className="facilities-spaces-head">
          <h3 className="facilities-band__title">
            Key spaces <em className="font-serif font-light italic text-mk-anchor-blue">being shaped.</em>
          </h3>
          <p className="facilities-spaces-head__copy">
            Each space is being designed with partners. What is listed below is the working brief, open to your input.
          </p>
        </div>
        <div className="facilities-spaces">
          {spaces.map((space) => (
            <button
              className="facilities-space group"
              key={space.number}
              onClick={() => voice.open(space.intent, { autoStart: false, mode: "form" })}
              type="button"
            >
              <div className="facilities-space__img">
                <Image
                  alt={space.title}
                  className="object-cover transition duration-500 group-hover:scale-[1.02]"
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  src={space.image}
                />
                <span className="facilities-space__img-num">{space.number}</span>
              </div>
              <div className="facilities-space__body">
                <h4>{space.title}</h4>
                <p>{space.description}</p>
                <span className="facilities-space__cta">
                  {space.cta}
                  <span aria-hidden> →</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

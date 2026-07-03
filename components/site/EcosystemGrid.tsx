"use client";

import { ArrowUpRight, Cpu, FlaskConical, Sparkles, UsersRound } from "lucide-react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useVoice } from "@/components/voice-agent/voice-state";
import { ecosystemCells } from "@/lib/content";

const icons = [UsersRound, Cpu, Sparkles, FlaskConical];

export function EcosystemGrid() {
  const voice = useVoice();

  return (
    <>
      <div className="eco-grid">
        {ecosystemCells.map((cell, index) => {
          const Icon = icons[index] ?? Sparkles;
          return (
            <button
              className="eco-cell group"
              key={cell.number}
              onClick={() => voice.open(cell.intent, { autoStart: false, mode: "form" })}
              type="button"
            >
              <div className="eco-cell__num">{cell.number}</div>
              <Icon aria-hidden className="eco-cell__icon" />
              <h3>{cell.title}</h3>
              <p className="eco-cell__desc">{cell.description}</p>
              <ArrowUpRight aria-hidden className="eco-cell__arrow" />
            </button>
          );
        })}
      </div>
      <div className="eco-foot">
        <p>
          Designed for educators, creatives, organisations, communities, entrepreneurs, and future-focused
          collaborators.
        </p>
        <button
          className="voice-cta"
          onClick={() => voice.open(undefined, { autoStart: false, mode: "form" })}
          type="button"
        >
          <span className="voice-cta__orb">
            <MiniOrb size={32} />
          </span>
          <span>Discuss a partnership</span>
        </button>
      </div>
    </>
  );
}

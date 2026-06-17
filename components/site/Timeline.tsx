"use client";

import { useState } from "react";
import { timelineSteps } from "@/lib/content";
import { cn } from "@/lib/utils";

export function Timeline() {
  const [active, setActive] = useState(1);

  return (
    <section className="bg-mk-paper py-section" data-screen-label="06 Timeline" id="timeline">
      <div className="mx-auto max-w-wrap px-gutter">
        <span className="section-num">
          <span className="bar" />
          06 — The Journey Ahead
        </span>
        <h2 className="section-heading max-w-4xl">
          From planning to <em>public activation.</em>
        </h2>
        <div className="timeline" data-progress={active}>
          {timelineSteps.map((step, index) => (
            <button
              className={cn("timeline-step", index < active && "timeline-step--done")}
              key={step.phase}
              onFocus={() => setActive(index + 1)}
              onMouseEnter={() => setActive(index + 1)}
              type="button"
            >
              <span className="timeline-step__marker" />
              <div className="timeline-step__year">{step.timeline}</div>
              <div className="timeline-step__phase">Phase {String(index + 1).padStart(2, "0")}</div>
              <h3 className="timeline-step__label">{step.phase}</h3>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

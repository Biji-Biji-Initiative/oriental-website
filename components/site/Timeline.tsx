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
        <div className="relative mt-16 grid gap-7 lg:grid-cols-3">
          <div className="absolute left-0 top-4 hidden h-px w-full bg-mk-line lg:block" />
          <div
            className="absolute left-0 top-4 hidden h-px bg-mk-anchor-blue transition-all lg:block"
            style={{ width: `${(active / 3) * 100}%` }}
          />
          {timelineSteps.map((step, index) => (
            <button
              className="relative rounded-[18px] border border-mk-line bg-white/50 p-6 text-left transition hover:-translate-y-1 hover:border-mk-anchor-blue/35 hover:bg-white"
              key={step.phase}
              onMouseEnter={() => setActive(index + 1)}
              type="button"
            >
              <span
                className={cn(
                  "mb-8 block size-8 rounded-full border border-mk-anchor-blue bg-mk-paper",
                  index < active && "bg-mk-anchor-blue",
                )}
              />
              <div className="text-4xl font-semibold text-mk-anchor-blue">{step.year}</div>
              <div className="mt-4 text-xs uppercase tracking-[0.16em] text-mk-off-black/44">{step.phase}</div>
              <h3 className="mt-2 text-2xl font-semibold">{step.label}</h3>
              <p className="mt-4 leading-7 text-mk-off-black/64">{step.description}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

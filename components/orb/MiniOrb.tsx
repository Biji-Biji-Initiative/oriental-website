"use client";

import { useId } from "react";
import { MEREKA_MARK_DOT, MEREKA_MARK_PATH, MEREKA_MARK_VIEWBOX } from "@/lib/brand-motion";

export function MiniOrb({ size = 36 }: { size?: number }) {
  const id = useId().replaceAll(":", "");
  const gradientId = `mereka-mark-gradient-${id}`;
  return (
    <svg
      aria-hidden="true"
      className="mereka-mini-mark"
      data-mereka-mark="true"
      height={size}
      viewBox={MEREKA_MARK_VIEWBOX}
      width={size}
    >
      <defs>
        <linearGradient id={gradientId} x1="4%" x2="96%" y1="8%" y2="92%">
          <stop offset="0%" stopColor="#2851a8" />
          <stop offset="32%" stopColor="#4f83c8" />
          <stop offset="62%" stopColor="#73c0c9" />
          <stop offset="82%" stopColor="#eef3f8" />
          <stop offset="100%" stopColor="#2851a8" />
        </linearGradient>
      </defs>
      <path className="mereka-mini-mark__aura" d={MEREKA_MARK_PATH} />
      <circle
        className="mereka-mini-mark__aura"
        cx={MEREKA_MARK_DOT.cx}
        cy={MEREKA_MARK_DOT.cy}
        r={MEREKA_MARK_DOT.radius}
      />
      <path className="mereka-mini-mark__body" d={MEREKA_MARK_PATH} fill={`url(#${gradientId})`} />
      <circle
        className="mereka-mini-mark__dot"
        cx={MEREKA_MARK_DOT.cx}
        cy={MEREKA_MARK_DOT.cy}
        fill={`url(#${gradientId})`}
        r={MEREKA_MARK_DOT.radius}
      />
      <path className="mereka-mini-mark__trace" d={MEREKA_MARK_PATH} pathLength={1} />
    </svg>
  );
}

"use client";

/** The unchanged production voice-orb centre used when staging motion is off. */
export function MiniOrb({ size = 36 }: { size?: number }) {
  const gradientId = `mini-orb-${size}`;
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 36 36" width={size}>
      <defs>
        <radialGradient cx="40%" cy="35%" id={gradientId} r="65%">
          <stop offset="0%" stopColor="#c3d4ee" />
          <stop offset="55%" stopColor="#5c7db8" />
          <stop offset="100%" stopColor="#1f3f7c" />
        </radialGradient>
      </defs>
      <circle cx="18" cy="18" fill={`url(#${gradientId})`} r="14" />
      <circle cx="13" cy="12" fill="rgba(255,255,255,0.72)" r="3.4" />
      <circle
        className="motion-safe:animate-pulse"
        cx="18"
        cy="18"
        fill="none"
        r="17"
        stroke="rgba(255,255,255,0.32)"
        strokeWidth="1"
      />
    </svg>
  );
}

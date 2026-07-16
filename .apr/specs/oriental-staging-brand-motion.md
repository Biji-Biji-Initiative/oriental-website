# Oriental staging brand-motion preview — ship review

Review exact commit `18063d6c48a76bbb181001a3f66431cdaf8653a0` as a
staging-only visual preview. Production safety and browser resilience matter
more than novelty.

## Required contract

- The new motion MUST be disabled unless
  `NEXT_PUBLIC_BRAND_MOTION_PREVIEW=true` and the browser host is
  `staging.oriental.mereka.io`, localhost, or loopback.
- Production `oriental.mereka.io` MUST retain the existing SVG MiniOrb and MUST
  not show the staging loader.
- The staging deploy helper MUST set the preview build argument only for the
  staging image and MUST leave the production image build unchanged.
- Reduced-motion users and browsers without WebGL/Path2D MUST receive a stable
  approved-mark fallback with no animation requirement.
- The canvas lifecycle MUST release animation frames, event listeners, and GPU
  resources on unmount. Resize and device-pixel-ratio work MUST be bounded.
- The nebula surface is decorative and MUST remain hidden from assistive
  technology. Pointer parallax MUST not create a focus target or interfere
  with voice controls.
- The site loader MUST release document scrolling on completion and cleanup.
- Particle positions MUST use the canonical Mereka mark geometry rather than an
  approximate redraw.
- The preview MUST retain all existing voice connection and turn-state
  behavior; this is a visual layer, not a transport change.
- Focused tests MUST prove host gating, canonical geometry, reduced-motion
  fallback, loader timing metadata, and production opt-out.

## Review request

Inspect the attached implementation adversarially for a production leak,
unbounded GPU/CPU work, cleanup bugs, hydration/accessibility problems,
reduced-motion violations, brittle WebGL behavior, or a mismatch between the
tests and the actual runtime gate. Report only concrete findings, ordered by
severity, and end with exactly `VERDICT: SHIP STAGING PREVIEW` or
`VERDICT: DO NOT SHIP`.

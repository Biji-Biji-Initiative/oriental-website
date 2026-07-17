# Oriental Mereka brand motion — ship review

Review the current integration tree based on
`b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e` as the approved Mereka visual for
canonical staging and production. Browser resilience matters more than novelty.

## Required contract

- The approved M nebula and Trace M loader MUST render on both
  `staging.oriental.mereka.io` and `oriental.mereka.io` without a public build
  flag or runtime hostname gate.
- The visual release MUST NOT change production voice governance: production
  remains control-model and picker-off even when it runs the same web image.
- Reduced-motion users and browsers without WebGL/Path2D MUST receive a stable
  approved-mark fallback with no animation requirement.
- The canvas lifecycle MUST release animation frames, event listeners, and GPU
  resources on unmount. Resize and device-pixel-ratio work MUST be bounded.
- The adaptive audio gate MUST visibly react to live speech and remote audio,
  retain open/close hysteresis, and learn sustained 0.12–0.20 room noise until
  it converges inactive.
- The nebula surface is decorative and MUST remain hidden from assistive
  technology. Pointer parallax MUST not create a focus target or interfere
  with voice controls.
- The site loader MUST release document scrolling on completion and cleanup.
- Particle positions MUST use the canonical Mereka mark geometry rather than
  an approximate redraw.
- The visual MUST retain all existing voice connection and turn-state behavior;
  it is a presentation layer, not a transport change.
- Focused tests MUST prove canonical geometry, production/staging inclusion,
  reduced-motion fallback, loader timing metadata, bounded audio behavior, and
  cleanup.

## Review request

Inspect the attached implementation adversarially for unbounded GPU/CPU work,
cleanup bugs, hydration/accessibility problems, reduced-motion violations,
brittle WebGL behavior, a production voice-governance leak, or a mismatch
between tests and runtime behavior. Report only concrete findings, ordered by
severity, and end with exactly `VERDICT: SHIP BRAND MOTION` or
`VERDICT: DO NOT SHIP`.

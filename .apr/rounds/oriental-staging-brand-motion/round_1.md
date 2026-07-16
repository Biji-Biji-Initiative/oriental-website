Here is the adversarial ship review of the provided WebGL implementation, evaluating it against the specified production safety and accessibility contracts.

### Findings

**1. Unbounded CPU Work & Layout Thrashing (Blocker)**
- **Location:** `components/brand-motion/NebulaM.tsx:248-251`
- **Details:** The `draw` function actively executes `canvas.closest<HTMLElement>(".voice-orb")` and `window.getComputedStyle(levelSource)` directly inside the `requestAnimationFrame` loop. Querying the DOM tree and forcing synchronous style calculations 60 times a second will cause massive layout thrashing, severely degrading framerates and burning CPU. These values must be passed as props or read via a `MutationObserver`/event listener, rather than polled inside the render loop.

**2. Accessibility / Misleading Announcement Regression (Blocker)**
- **Location:** `components/brand-motion/NebulaM.tsx:303-319`
- **Details:** When the component falls back (e.g., for users preferring reduced motion or lacking WebGL), it still renders as a focusable `<button>` with the `aria-label="Interactive Mereka nebula — press to resolve the stars into the M mark"`. Because the fallback mark is completely static and does not respond to interaction, presenting it as an interactive button violates the contract stating that "Decorative surfaces MUST not create misleading announcements."

**3. GPU Resource Leak / Cleanup Error on Initialization (Blocker)**
- **Location:** `components/brand-motion/NebulaM.tsx:151-157`
- **Details:** In the initialization `try/catch` block, if `createProgram` succeeds but `createParticleField` throws (e.g., Canvas 2D is disabled), the `catch` block calls `setFallback(true)` and issues an early `return`. Because it returns early, the `useEffect` never registers its teardown function. The successfully compiled WebGL `program` is permanently leaked in GPU memory.

**4. Unhandled Exceptions Breaking Unmount Cleanup (Blocker)**
- **Location:** `components/brand-motion/NebulaM.tsx:159-179`
- **Details:** The attributes and uniforms are mapped using `requireAttribute` and `requireUniform`, which deliberately throw an `Error` if a location is not found. Since these calls are outside of the `try/catch` block, any failure here will cause an unhandled exception in the `useEffect`. This crashes the effect, skips the cleanup function registration, and permanently leaks the `program` and any partially bound WebGL buffers.

VERDICT: DO NOT SHIP

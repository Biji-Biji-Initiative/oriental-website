Here is the adversarial ship review of the provided WebGL brand-motion implementation.

### 1. Zombie Render Loop on WebGL Context Loss (Blocker)
**Location:** `components/brand-motion/NebulaM.tsx:212-216` and `components/brand-motion/NebulaM.tsx:259-271`
**Violation:** Unbounded CPU/GPU work and cleanup errors.

The component correctly halts the animation and flags the fallback when the WebGL context is lost (`onContextLost`), but critically fails to tear down its external event listeners (`visibilitychange` on the `document` and the `ResizeObserver` on the `canvas`).

Because the `useEffect` cleanup function is tied exclusively to unmounts and the `levelsRef` dependency, navigating away and back to the tab triggers `onVisibilityChange`. This sets `visible = true` and fires `window.requestAnimationFrame(draw)`, permanently resurrecting the render loop. The application will then spam invalid WebGL commands (`gl.clear`, `gl.useProgram`, `gl.drawArrays`) against a dead context at 60fps, creating unbounded CPU overhead and console pollution. Similarly, window resizes will trigger invalid `gl.viewport` commands.

To fix this, the context loss handler must permanently lock out the `draw` loop or the `useEffect` should detach the event listeners when falling back.

### 2. Main-Thread Blocking in Rejection Sampling (Risk/Note)
**Location:** `components/brand-motion/NebulaM.tsx:341-348`
**Violation:** Potential layout blocking during hydration.

The initial seed generation uses a rejection sampling loop (`while (accepted < MEREKA_NEBULA_PARTICLE_COUNT)`) against an SVG `Path2D` geometry block. While correctly utilizing the canonical geometry as contracted, running an indeterminate loop using `context.isPointInPath()` on the main thread during the initial client-side `useEffect` can block hydration or page interactivity depending on the size of the mark and the total particle count. It is highly recommended to shift this calculation to a Web Worker or precompute the geometric origins offline.

### 3. State Desync if Prop Dependencies Change After Fallback (Minor)
**Location:** `components/brand-motion/NebulaM.tsx:123-124` and `components/brand-motion/NebulaM.tsx:264-271`
**Violation:** Cleanup/lifecycle mismatch.

If the `levelsRef` identity ever changes after a failure or a `webglcontextlost` event has already fired, the `useEffect` will clean up and attempt to rebuild the WebGL context. However, `setFallback(false)` is never invoked on success, so the component will successfully reallocate all GPU buffers and start spinning the CPU render loop, but the interactive control button and canvas surface will remain permanently hidden behind `data-fallback="true"`.

VERDICT: DO NOT SHIP

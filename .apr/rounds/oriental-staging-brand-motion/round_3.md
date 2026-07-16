This implementation contains a direct violation of the accessibility and reduced-motion contract, making it unsafe to ship.

### 1. Accessibility / Misleading Announcement (Blocker)
**Location:** `components/brand-motion/NebulaM.tsx:320-327`
The implementation provides a focusable `<button>` with an `aria-label` ("Interactive Mereka nebula — press to resolve the stars into the M mark"). Because the interaction solely drives a visual WebGL shader state (`toggleResolve`) and has no meaningful semantic outcome for the application, it creates a false affordance for screen reader users. This explicitly violates the requirement: *"Decorative surfaces MUST not create misleading announcements."*

### 2. Unbounded GPU / Resize Work (Risk)
**Location:** `components/brand-motion/NebulaM.tsx:191-203`
The `resize` callback reads `canvas.getBoundingClientRect()`, scales the dimensions by `window.devicePixelRatio`, and writes them back to `canvas.width` and `canvas.height`. If the external `.mereka-nebula__canvas` CSS class does not strictly constrain the element's layout footprint (e.g., `width: 100%; height: 100%`), updating the internal canvas resolution will expand its intrinsic CSS layout size. This will immediately re-trigger the `ResizeObserver`, causing an infinite, unbounded loop of scaling and DPR calculations that will lock the main thread. To safely bind this, the component should enforce its own inline styles (e.g., `style={{ width: "100%", height: "100%" }}`) or calculate the size against `ResizeObserverEntry.contentRect` instead of the layout rect.

### 3. Graceful Context Restoration (Minor)
**Location:** `components/brand-motion/NebulaM.tsx:220-229`
The `webglcontextlost` listener calls `event.preventDefault()`, which signals to the browser that the app intends to restore the context via `webglcontextrestored`. However, the app immediately unmounts the WebGL logic and falls back to the static SVG without ever listening for the restoration event. While harmless because of the fallback state, `event.preventDefault()` should be removed if you do not intend to restore the context, allowing the browser to cleanly garbage-collect the lost context.

VERDICT: DO NOT SHIP

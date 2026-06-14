# DetectiveClueNetwork Component Redesign Spec

This specification outlines the redesign of the `DetectiveClueNetwork` component inside the "Red Herring and Gun" AI rumor verification system. The goal is to elevate the visual metaphor of multi-agent information flowing toward and being absorbed by a central Large Language Model (LLM) claim node.

To allow side-by-side aesthetic and performance evaluation, two animation engines (Framer Motion and GSAP) will be implemented simultaneously and toggled dynamically in the UI.

---

## 1. Visual Metaphor Upgrades

### A. Rotating Glow Halo
* **Concept**: Two concentric gradient halo rings underneath the center CLAIM node that rotate in opposite directions to represent the "gravitational attraction" of the大模型 (LLM).
* **Styling**: Gradient borders, blurred backdrop, HSL colors (`hsla(220, 80%, 60%, 0.15)`), and Heterogeneous rotation speeds.

### B. Absorption Ripple Effect
* **Concept**: Multi-stage circular wave expanding outward from the center node as soon as a text pill lands, simulating absorption impact.
* **Aesthetics**: Stroke-only circles expanding from scale `1` to `2.5`, fading to `opacity: 0` using a quick outward ease.

### C. 引力连线 (Attraction Lines / Light Trails)
* **Concept**: Faint connection trails linking each active flowing clue pill directly to the center.
* **Aesthetics**: Semitransparent SVG paths (`stroke: rgba(100, 150, 255, 0.2)`), dashed strokes (`stroke-dasharray`), and traveling light pulses.

### D. Particle Scattering (爆裂粒子)
* **Concept**: When a clue pill lands at the center boundary, it disappears and scatters 6 to 8 light particles outward in random polar vectors, which decelerate and fade.

---

## 2. Technical Architecture & File Structure

We will separate the two engine implementations into separate files to avoid codebase tangling, referencing them in a unified wrapper component.

```
src/components/v3/phases/mission/
├── DetectiveClueNetwork.tsx         (Unified Wrapper & Engine Switcher)
├── DetectiveClueNetworkFramer.tsx   (Approach 1: Framer Motion)
└── DetectiveClueNetworkGSAP.tsx     (Approach 2: GSAP timeline & SVG)
```

### File Breakdown

#### 1. `DetectiveClueNetwork.tsx` (Wrapper Component)
* Manages the active engine state: `engine: "framer" | "gsap"` (default to `"framer"`).
* Renders a clean pill-shaped toggle button in the top-right corner of the network layer.
* Passes `claim`, `steps`, and `currentStep` downstream to the selected engine.

#### 2. `DetectiveClueNetworkFramer.tsx`
* Uses Framer Motion's `<motion.div>` and `<AnimatePresence>` for all layers.
* Renders the center halo using looping infinite animations.
* Appends temporary ripples and explosion particles directly to state arrays, animating them with Framer Motion keys and unmounting them on complete.

#### 3. `DetectiveClueNetworkGSAP.tsx`
* Utilizes a single unified timeline or individual `gsap.to()` invocations.
* Controls clues via GSAP timelines, incorporating curved/sinusoidal paths (magnetic pull) toward center coordinates.
* Uses GSAP timeline callbacks (`onComplete`) to spawn HTML/SVG ripples and particles with physics easing curves.

---

## 3. Style Enhancements (`styles.css`)

We will introduce specific, non-conflicting `.dcn-` style classes to support both implementations:
* `.dcn-engine-toggle`: Style for the engine selector pill in the top-right corner.
* `.dcn-center-halo`: Styles for the dual rotating background halos.
* `.dcn-ripple`: Style for the concentric impact ripples.
* `.dcn-particle`: Style for the scattered particles.
* `.dcn-connection-line`: SVG container and path styles for the attraction trails.

---

## 4. Verification & Testing Plan
* **Build Verification**: Run `npm run build` to ensure no TypeScript compilation or bundler issues arise.
* **Runtime Verification**: Verify smooth frame rendering and proper cleanup of completed DOM/SVG nodes under both engines (limiting maximum active nodes to 30 to prevent leaks).

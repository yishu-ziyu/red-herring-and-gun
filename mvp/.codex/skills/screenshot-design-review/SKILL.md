---
name: screenshot-design-review
description: Use after UI changes to review screenshots for hierarchy, spacing, color discipline, interaction clarity, and Agent observability before claiming completion.
---

# Screenshot Design Review

Use this after implementing frontend changes and before saying the UI is done.

## Required Review Inputs

- A screenshot of the actual running UI.
- The route/state being reviewed.
- The intended viewer and core action.

## Review Checklist

1. **Focal Point**
   - Is there one clear primary area?
   - Does the user's eye know where to start?

2. **Agent Observability**
   - Is the active Agent obvious?
   - Can the user inspect Agent role, tools, model, latency, and handoff on demand?
   - Are logs compact unless expanded?

3. **Evidence Traceability**
   - Can the user see source tracing, cross-verification, logic gaps, and evidence-chain state?
   - Can they click from report/evidence summary into details?

4. **Color Discipline**
   - Are status colors sparse and consistent?
   - Are too many accent colors competing?
   - Is red reserved for blocking/failure?

5. **Layout and Density**
   - Are panels aligned?
   - Are cards nested too deeply?
   - Is text overflowing or visually noisy?
   - Does the bottom dock obscure important content?

6. **Real Path Integrity**
   - No demo labels in the real path.
   - No pre-baked examples.
   - No fake final verdict when model/search failed.

## Output Format

Return:

1. **Pass / Needs Work**
2. **Top 3 Visual Problems**
3. **Top 3 Interaction Problems**
4. **Concrete CSS/Component Fixes**
5. **Verification To Run Again**

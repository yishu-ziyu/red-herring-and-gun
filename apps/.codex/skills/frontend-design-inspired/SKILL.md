---
name: frontend-design-inspired
description: Use when implementing Red Herring and Gun frontend UI so the design has a deliberate visual direction instead of generic AI dashboard styling.
---

# Frontend Design Inspired

This skill adapts the "frontend-design" workflow to this project.

## Before Implementation

Commit to one visual direction:

- **Investigation Desk**: warm paper, ink, sharp borders, restrained active accent.
- **Field Case Board**: evidence strips, agent badges, source cards, low-saturation status marks.
- **Reading Room**: report-first, dense but quiet, source references treated like footnotes.

Default for this project: **Investigation Desk**.

## Design Rules

- Make the product feel specific to rumor verification and evidence work.
- Use fewer colors than feels comfortable.
- Let spacing, border weight, typography, and layout carry hierarchy.
- Make one thing visually primary on each screen.
- Keep live Agent work observable through compact dispatch records and badge details, not giant permanent logs.
- Preserve source traceability: every final claim should have a path to evidence.

## Implementation Rules

- Match existing React + TypeScript + Vite patterns.
- Keep components decoupled by product role:
  - Controller rail
  - Current-stage workbench
  - Proof/evidence maturity strip
  - Agent badge dock
  - Detail drawer
- Do not add fake content to make a screen feel complete.
- If data is missing, show a quiet unavailable state.
- Prefer existing CSS variables before adding new color literals.

## Anti-Patterns

- Four or more equally strong accent colors on one screen.
- Repeated Agent identity blocks in multiple places.
- Central workbench plus right log plus bottom timeline all competing.
- Big cards inside big cards.
- Marketing copy inside a tool surface.
- "Looks advanced" effects that do not clarify the Agent process.

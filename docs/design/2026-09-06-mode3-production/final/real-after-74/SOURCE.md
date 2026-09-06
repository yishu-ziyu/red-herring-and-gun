# SOURCE — REAL post-#74 verification (this directory only)

This folder is REAL SSE after #74 squash-merge. It is not the pre-#74 failure specimen.
Do not mix with `../real/` (pre-#74) or fixture captures.

- Real investigation input: `维生素C能治感冒，而且每次感冒都应当输液。`
- SSE phases: `['received', 'decomposed', 'investigating', 'investigating', 'investigating', 'judging', 'judging', 'judging', 'complete']`
- DOM phases: `['received', 'investigating', 'judging', 'complete']`
- Evidence role transition: `{'claimId': 'claim-1', 'sourceId': 'src-1', 'from': 'unassessed', 'to': 'support', 'atPhase': 'judging'}`
- Stance audit: `{'found': True, 'claimId': 'claim-2', 'judgment': 'refuted', 'roles': ['contradict', 'contradict', 'contradict', 'context-only', 'context-only'], 'supportCount': 0, 'contradictCount': 3, 'reverseEvidence': [], 'reverseStillSupport': False}`
- Conflict/gap image: REAL SSE
- Duration: 184.8s

## REAL SSE (live orchestrate-stream, post-#74)

- `desktop-input.png`
- `desktop-real-decomposed.png` (if phase observed live)
- `desktop-real-investigating.png`
- `desktop-real-complete.png`
- `desktop-complete-grayscale.png`
- `desktop-source-drawer.png`
- `mobile-input.png`
- `mobile-real-complete.png`
- `mobile-source-sheet.png`
- `desktop-reduced-motion-complete.png` (same complete + emulated reduced-motion)
- `snapshots/*.json`
- `motion/real-sse-desktop.webm`

## DETERMINISTIC FIXTURE (captured here, not the live investigation)

- `motion/frames-reduced/fixture-settling-*.png` and `fixture-settling-reduced.gif`
- `motion/fixture-conclusion-reduced-complete.png`
- `desktop-conflict-gap.png` — REAL SSE

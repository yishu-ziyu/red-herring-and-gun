# SOURCE — REAL post-#76 verification (this directory only)

This folder is REAL SSE after #76 / PR #77 squash-merge. Stance was already fixed in #74.
Do not mix with `../real/` (pre-#74 stance failure) or `../real-after-74/` (source-id instability).

- Real investigation input: `维生素C能治感冒，而且每次感冒都应当输液。`
- SSE phases: `['received', 'decomposed', 'investigating', 'investigating', 'judging', 'judging', 'judging', 'complete']`
- DOM phases: `['received', 'investigating', 'judging', 'complete']`
- Semantic Evidence transition: `{'claimId': 'claim-1', 'sourceId': 'src-bd310b43063afb86', 'url': 'https://ltxc.cqnu.edu.cn/info/1140/7130.htm', 'from': 'unassessed', 'to': 'support', 'atPhase': 'judging'}`
- sourceIdsStable: `True`
- Live settling same node: `True`
- Stance audit: `{'found': True, 'claimId': 'claim-2', 'judgment': 'not-applicable', 'roles': [], 'supportCount': 0, 'contradictCount': 0, 'reverseEvidence': [], 'reverseStillSupport': False}`
- Conflict/gap image: REAL SSE
- Duration: 80.7s

## REAL SSE (live orchestrate-stream, post-#76)

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

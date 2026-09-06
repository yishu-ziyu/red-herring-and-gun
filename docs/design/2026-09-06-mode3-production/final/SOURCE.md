# SOURCE — Issue #66 production integration artifacts

Every file in this directory is tagged. Fixture is never a substitute for the live stream.

- Real investigation input: `维生素C能治感冒，而且每次感冒都应当输液。`
- Live SSE phases: received → decomposed → investigating → judging → complete (193.2s)
- Evidence role transition (snapshot): claim-1 / src-1 `unassessed → support` at judging
- Evidence role transition (DOM, REAL SNAPSHOT REPLAY of those same frames): `claim-1:src-1` identity=stable, `before === after`
- Claim Trace: both claims `originalClaim.slice(start,end) === claim.text` (exact)
- Conflict: none in this real run. Gap: present (REAL SSE)
- Producer gap (not rewritten in UI): claim-2 findings that deny「每次感冒都应当输液」were emitted as `role: support`. Recorded honestly. Not hand-edited.

## REAL SSE (live orchestrate-stream)

- `desktop-input.png`
- `desktop-real-investigating.png` — live canvas at first investigating paint (claims present, sources not yet attached)
- `desktop-real-judging.png`
- `desktop-real-complete.png`
- `desktop-complete-grayscale.png` — derived from live complete
- `desktop-conflict-gap.png` — live complete; gap present, no conflict
- `desktop-source-drawer.png` / `desktop-source-drawer-grayscale.png`
- `desktop-real-claim-trace-hover.png`
- `desktop-reduced-motion-complete.png` — live complete + emulated `prefers-reduced-motion` (not a second live stream)
- `mobile-input.png`
- `mobile-real-investigating.png` — live, viewport 390 during investigating
- `mobile-real-complete.png` / `mobile-complete-grayscale.png`
- `mobile-source-sheet.png` / `mobile-source-sheet-grayscale.png`
- `real/snapshots/*.json` — every `investigation_snapshot` from the live SSE
- `real/motion/real-sse-desktop.webm` — Playwright recording of the live desktop run
- `real/motion/live-keyframes/live-019.png` investigating
- `real/motion/live-keyframes/live-047.png` judging
- `real/motion/live-keyframes/live-189.png` complete
- `real/run-report.json` / `real/keyboard.json` / `real/editorial-audit.json`

## REAL SNAPSHOT REPLAY (same SSE JSON, production components, not a second model call)

DOM skipped `decomposed` in the live paint (received jumped to investigating). Replay uses `02-decomposed.json` / `05-investigating-5.json` / `06-judging.json` from that live stream via DEV `/?fixture=replay`.

- `desktop-real-decomposed.png`
- `desktop-real-investigating-unassessed.png` — unassessed rows from live snapshot 05
- `desktop-real-judging-settled.png`
- `desktop-real-complete-replay.png`
- `real/motion/real-settling-replay.gif` + `real/motion/frames/real-settling-*.png`
- `real/settling-dom.json` — src-1 node `same: true`

## DETERMINISTIC FIXTURE (golden mixed/settling, not this investigation)

- `real/motion/frames-reduced/fixture-settling-*.png`
- `real/motion/fixture-settling-reduced.gif`
- `real/motion/fixture-conclusion-reduced-complete.png`

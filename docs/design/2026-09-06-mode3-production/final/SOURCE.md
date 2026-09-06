# SOURCE — Issue #66 production integration artifacts

Every file is tagged. Fixture is never a substitute for the live stream. Three real runs are separate specimens; do not mix or overwrite them.

- Real investigation input (all three runs): `维生素C能治感冒，而且每次感冒都应当输液。`

## 1. REAL pre-#74 failure

`final/real/` plus the screenshots in this `final/` directory (not under `real-after-74/` or `real-after-76/`).

This is the original #66 live production specimen. It is also the #74 bug specimen. **Do not overwrite.**

- Live SSE phases: received → decomposed → investigating ×3 → judging ×3 → complete (193.2s)
- Model: MiniMax-M2.7-highspeed; cross_examiner once failed on StepFun and fell back to MiniMax
- Claim Trace: both claims `originalClaim.slice(start,end) === claim.text` (exact)
- Evidence Settling (snapshot): claim-1 / src-1 `unassessed → support` at judging
- Producer gap: claim-2 findings that deny「每次感冒都应当输液」were `role: support`, judgment=`unresolved`. Recorded honestly. Not hand-edited.

Files:

- `desktop-input.png` / `desktop-real-investigating.png` / `desktop-real-judging.png` / `desktop-real-complete.png`
- `desktop-complete-grayscale.png` / `desktop-conflict-gap.png` / `desktop-source-drawer.png` / `desktop-real-claim-trace-hover.png` / `desktop-reduced-motion-complete.png`
- `mobile-input.png` / `mobile-real-investigating.png` / `mobile-real-complete.png` / `mobile-source-sheet.png` and grayscale derivatives
- `real/snapshots/*.json`
- `real/motion/real-sse-desktop.webm`
- `real/run-report.json` / `real/keyboard.json` / `real/editorial-audit.json`

## 2. REAL post-#74 verification (source identity failure)

`final/real-after-74/` only. Live `orchestrate-stream` after #74 squash-merge (`7ad8103`). Not a fixture. Not a hand-edited Snapshot. Not a replay of the old JSON. **Do not overwrite.**

- Live SSE phases: received → decomposed → investigating ×3 → judging ×3 → complete (184.8s)
- Stance: claim-2 reverse evidence is `role=contradict`, judgment=`refuted`. finding / excerpt / role / judgment agree.
- Claim-1 mixed dual-bucket: support + contradict; finding keeps `[1][2][3]`.
- Source identity failure: the URL `https://ltxc.cqnu.edu.cn/info/1140/7130.htm` went unassessed→support, but investigating `src-3` rematerialized as judging `src-1`. Replay `settling-dom.json`: `sourceIdsStable=false`, `same: false`. Recorded, not patched in UI. This is the #76 specimen.

Files:

- `real-after-74/desktop-*.png` / `real-after-74/mobile-*.png` and grayscale
- `real-after-74/snapshots/*.json` including `complete.json`
- `real-after-74/motion/real-sse-desktop.webm`
- `real-after-74/run-report.json` / `keyboard.json` / `editorial-audit.json` / `gate.json` / `settling-dom.json`

## 3. REAL post-#76 verification (source identity fixed, Evidence Settling verified)

`final/real-after-76/` only. Live `orchestrate-stream` after #76 / PR #77 squash-merge (`f009d34`). Same sentence. Not a fixture. Not a replay pretending to be live.

- Live SSE phases: received → decomposed → investigating ×2 → judging ×3 → complete (80.7s to complete)
- Model path: production MiniMax / StepFun stack on local `mvp npm run dev -- --port 5186`
- Source ids are URL-hash (`src-` + 16 hex), stable across snapshots
- Semantic Evidence Settling: claim-1 + `https://ltxc.cqnu.edu.cn/info/1140/7130.htm` + `src-bd310b43063afb86` + `unassessed → support` at judging
- Live DOM: that node `before === after` (`same: true`, identity=`stable`). Four other unassessed→role nodes on the same live stream also `same: true`
- Replay of this run's snapshots: `settling-dom.json` `same: true`, `sourceIdsStable: true`, `fromId === toId`
- Final `gate.json` PASS. This cannot be PASS with `settling-dom.json same: false`
- Claim Trace: both spans exact
- #74: this run did not attach reverse IV evidence to claim-2 (checkability=`not-applicable`, evidence `[]`). No reverse material was labeled `support`. Overall conclusion `judgment=refuted`; directAnswer still says ordinary colds do not need IV. Dual-bucket support+contradict did not appear on claim-1 this run (one support, rest context-only)
- Source Drawer (complete snapshot): resolve=`live`; Tab / Shift+Tab trap; Escape; focus return to `claim-1:src-a6b628e01561c1d7`
- Live DOM skipped decomposed (received jumped to investigating), same as prior runs; decomposed screenshot is REAL SNAPSHOT REPLAY of this run's JSON

Files:

- `real-after-76/desktop-*.png` / `real-after-76/mobile-*.png` and grayscale
- `real-after-76/snapshots/*.json` including `complete.json`
- `real-after-76/motion/real-sse-desktop.webm` (live) + `real-settling-replay.gif`
- `real-after-76/run-report.json` / `keyboard.json` / `editorial-audit.json` / `gate.json` / `settling-dom.json` / `live-settling.json`

## 4. REAL SNAPSHOT REPLAY

Same SSE JSON as that run, production components, **not a second model call**. DEV `/?fixture=replay`.

Pre-#74 replay (of `final/real/snapshots`):

- `desktop-real-decomposed.png`
- `desktop-real-investigating-unassessed.png`
- `desktop-real-judging-settled.png`
- `desktop-real-complete-replay.png`
- `real/motion/real-settling-replay.gif` + `real/settling-dom.json`

Post-#74 replay (of `final/real-after-74/snapshots`):

- `real-after-74/desktop-real-decomposed.png`
- `real-after-74/desktop-real-investigating-unassessed.png`
- `real-after-74/desktop-real-judging-settled.png`
- `real-after-74/desktop-real-complete-replay.png`
- `real-after-74/motion/real-settling-replay.gif` + `real-after-74/settling-dom.json` (`same: false`, identity failure)

Post-#76 replay (of `final/real-after-76/snapshots`):

- `real-after-76/desktop-real-decomposed.png`
- `real-after-76/desktop-real-investigating-unassessed.png`
- `real-after-76/desktop-real-judging-settled.png`
- `real-after-76/desktop-real-complete-replay.png`
- `real-after-76/motion/real-settling-replay.gif` + `real-after-76/settling-dom.json` (`same: true`, `sourceIdsStable: true`)

## 5. DETERMINISTIC FIXTURE

Golden mixed/settling fixtures. **Not this investigation. Not a substitute for REAL SSE.**

- `real/motion/frames-reduced/fixture-settling-*.png`
- `real-after-74/motion/frames-reduced/fixture-settling-*.png`
- `real-after-76/motion/frames-reduced/fixture-settling-*.png`

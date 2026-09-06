# SOURCE — Issue #66 production integration artifacts

Every file is tagged. Fixture is never a substitute for the live stream. Pre-#74 and post-#74 real runs are separate; do not mix them.

- Real investigation input (both runs): `维生素C能治感冒，而且每次感冒都应当输液。`

## 1. REAL pre-#74 failure

`final/real/` plus the screenshots in this `final/` directory (not under `real-after-74/`).

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

## 2. REAL post-#74 verification

`final/real-after-74/` only. New live `orchestrate-stream` after #74 squash-merge (`7ad8103`). Not a fixture. Not a hand-edited Snapshot. Not a replay of the old JSON.

- Live SSE phases: received → decomposed → investigating ×3 → judging ×3 → complete (184.8s)
- Model: MiniMax-M2.7-highspeed for rumor/fact/source/evidence_loop/report. cross_examiner used step-3.7-flash and **completed** (no fallback this run)
- Claim-2 `每次感冒都应当输液`: judgment=`refuted`; cited reverse evidence (`感冒通常不需要输液` / `九成感冒病人完全没必要输液`) is `role=contradict`, not support. finding / excerpt / role / judgment agree.
- Claim-1 mixed dual-bucket: support (src-1) + contradict (src-2, src-3); finding keeps `[1][2][3]`. Same URL did not appear in both buckets this run.
- Claim Trace: both spans exact
- Evidence Settling (snapshot, by URL): CQNU 维生素C article `unassessed → support` at judging
- Conclusion Emergence (live): region / original / claims / board same node; `scrollY=0`; no auto-focus
- Source Drawer (live): resolve=`live`; Tab / Shift+Tab / Escape / focus return ok (`real-after-74/keyboard.json`)
- Live DOM skipped decomposed (received jumped to investigating), same as the pre-#74 run

Files:

- `real-after-74/desktop-*.png` / `real-after-74/mobile-*.png` and grayscale
- `real-after-74/snapshots/*.json` including `complete.json`
- `real-after-74/motion/real-sse-desktop.webm`
- `real-after-74/run-report.json` / `keyboard.json` / `editorial-audit.json` / `gate.json`

## 3. REAL SNAPSHOT REPLAY

Same SSE JSON as that run, production components, **not a second model call**. DEV `/?fixture=replay`.

Pre-#74 replay (of `final/real/snapshots`):

- `desktop-real-decomposed.png`
- `desktop-real-investigating-unassessed.png`
- `desktop-real-judging-settled.png`
- `desktop-real-complete-replay.png`
- `real/motion/real-settling-replay.gif` + `real/settling-dom.json` (`claim-1:src-1` identity=stable, `before === after`)

Post-#74 replay (of `final/real-after-74/snapshots`):

- `real-after-74/desktop-real-decomposed.png`
- `real-after-74/desktop-real-investigating-unassessed.png`
- `real-after-74/desktop-real-judging-settled.png`
- `real-after-74/desktop-real-complete-replay.png`
- `real-after-74/motion/real-settling-replay.gif` + `real-after-74/settling-dom.json`

Post-#74 settling note: the URL `https://ltxc.cqnu.edu.cn/info/1140/7130.htm` went unassessed→support, but investigating `src-3` rematerialized as judging `src-1` because the builder registers evidence-bucket sources first at judging. Replay therefore could not keep the same DOM node (`same: false`). Live investigating pin had no evidence rows yet (sources not attached). Container nodes (canvas / conclusion region / original / board) did not remount on the live complete. This is recorded, not patched in UI.

## 4. DETERMINISTIC FIXTURE

Golden mixed/settling fixtures. **Not this investigation. Not a substitute for REAL SSE.**

Pre-#74 copies:

- `real/motion/frames-reduced/fixture-settling-*.png`
- `real/motion/fixture-settling-reduced.gif`
- `real/motion/fixture-conclusion-reduced-complete.png`

Post-#74 recapture of the same fixtures (still fixture):

- `real-after-74/motion/frames-reduced/fixture-settling-*.png`
- `real-after-74/motion/fixture-settling-reduced.gif`
- `real-after-74/motion/fixture-conclusion-reduced-complete.png`

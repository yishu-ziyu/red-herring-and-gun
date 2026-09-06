# Mode 3 production walk screenshots

These images are **production Golden Path** rendered from the real `mvp/src/goldenPath/` tree.

| File | What it is | What it is not |
|---|---|---|
| `desktop-input.png` / `mobile-input.png` | Live input stage at 1440 / 390 | — |
| `desktop-input-grayscale.png` / `mobile-input-grayscale.png` | Same frames, 100% grayscale | — |
| `desktop-investigating-shell.png` | `/?fixture=investigating` deterministic fixture | Not a live SSE run |
| `desktop-investigating-conflict-gap.png` | `/?fixture=conflict` deterministic fixture, used to confirm Conflict / Gap are editorial annotations rather than inset cards | **Not real SSE.** Real SSE evidence belongs to #66. |

768 is verified in `scripts/capture_mode3_production.py` (`scrollWidth <= clientWidth`) and is not stored as a required screenshot.

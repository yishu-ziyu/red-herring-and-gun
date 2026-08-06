# 红鲱鱼与枪 · Agent notes

Project-level instructions for coding agents. Product truth lives in `docs/PRODUCT_SPEC.md`.

## Agent skills

### Issue tracker

GitHub Issues on `yishu-ziyu/red-herring-and-gun` via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` (created lazily) + `docs/adr/`. See `docs/agents/domain.md`.

### UI/UX expert subagents (agency-agents)

Already cloned for this project. **When UI/UX critique, IA, finish-gate, or persona walkthrough is needed, load and use them** — do not re-clone or invent a second set.

| What | Path |
|------|------|
| Full clone (local only, gitignored) | `vendor/agency-agents/` |
| Project wrappers (prefer these) | `docs/agents/uiux/*.md` |
| How to run a critique wave | `docs/agents/uiux/README.md` |
| How to customize wrappers | `docs/agents/uiux/CUSTOMIZE.md` |
| Location note | `docs/agents/uiux/SOURCE_LOCATION.md` |

**How to customize:** edit wrappers under `docs/agents/uiux/` (product lens + non-negotiables + spawn contract). **Do not** edit `vendor/agency-agents/` for product rules; never commit `vendor/`.

**When stream / UI work:** load the matching wrappers and **spawn in parallel** (typical wave: `ux-architect` + `ui-finish-gate` + `persona-walkthrough`; add `ui-designer` when tokens/components are the question). Parent: Playwright evidence first, then `spawn_subagent` with **full wrapper body pasted** + evidence paths. Product is **stream-first** process UI (not ops console); checklist lives in `docs/agents/uiux/README.md`.

Spawn via Grok `spawn_subagent` with the matching wrapper body + real browser evidence. Prefer wrappers over raw `source-*.md`.

## Lessons

- (2026-08-06) UI/UX work: register/use agency-agents subagents from `docs/agents/uiux/` when needed; clone lives at `vendor/agency-agents/` and must not be committed.
- (2026-08-06) Customize only via `docs/agents/uiux` wrappers; stream-first non-negotiables apply to all UI critique waves.

# Customizing UI/UX subagents (红鲱鱼)

Short recipe. Day-to-day use: `README.md` + wrappers. This file is for **editing the agent system**, not for a critique run.

## Rule

| Do | Do not |
|----|--------|
| Edit `docs/agents/uiux/<role>.md` | Edit `vendor/agency-agents/` for product rules |
| Add product non-negotiables to wrappers | Re-clone agency-agents into a second tree |
| Point at upstream for craft | Commit `vendor/` |
| Keep spawn contract explicit (evidence in, report out) | Rely on agent "remembering" product from chat only |

## Wrapper anatomy

```markdown
---
name: <Role> (红鲱鱼)
source: agency-agents/design/<upstream-file>.md
role: <one-line Chinese job>
---

You are **<Name>** for product **红鲱鱼与枪**.

## Product lens
## Non-negotiables (this product)
## Reference paths
## Mission this run
## Output
## Hard rules
```

- **Product lens**: job / not-job / primary user. Shared across all wrappers; keep in sync with README.
- **Non-negotiables**: stream-first, human labels, no ops console, approved design refs. Failures are P0/HOLD.
- **Reference paths**: absolute-from-repo paths the child must know (prototype, PRODUCT_SPEC, MissionControl).
- **Mission / Output**: what this role uniquely does and the report shape (Chinese unless noted).
- **Hard rules**: evidence before taste; no code unless asked.

## When to add a new wrapper

Only if a **repeatable critique role** is missing (e.g. a11y-only pass). Prefer extending an existing wrapper's mission checklist.

Steps:

1. Copy nearest wrapper.
2. Set `source:` to the upstream design file if one exists.
3. Keep shared Product lens + stream-first block; change Mission/Output only.
4. Register row in `README.md` table + one line in root `AGENTS.md` if it is a standard wave role.
5. Do not install into global `~/.claude/agents` for this product; Grok spawn + paste wrapper is the path.

## When to refresh from upstream

```bash
# vendor is local-only; pull when you want craft updates
cd vendor/agency-agents && git pull   # if you maintain it as a clone
```

Then **diff** `source-*.md` / upstream against wrappers. Port craft improvements; **never** overwrite product non-negotiables with generic SaaS advice.

## Stream-first reminder (all roles)

This product is **paste claim → progressive evidence stream → share/don't share**.  
If a critique would improve a generic multi-agent ops console but hurt the stream narrative, **reject the critique**.

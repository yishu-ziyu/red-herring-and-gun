# UI/UX Expert Subagents (from agency-agents)

Source: https://github.com/msitarzewski/agency-agents (`design/*`)

These are **project playbooks** for Grok `spawn_subagent`. They do not ship product code.
Use after a real browser walkthrough with screenshots under `mvp/output/uiux-audit/` (or `docs/uiux-audit/`).

| Agent file | Role | When |
|------------|------|------|
| `ux-architect.md` | Information architecture, layout system, hierarchy | Structure broken, density chaos, stream vs console confusion |
| `ui-finish-gate.md` | Product-specific finish gate; kill generic UI | Pre-ship / "looks AI-generated" / ops-console smell |
| `persona-walkthrough.md` | Cognitive walkthrough as a real user | Feel / friction / trust / "would I forward?" |
| `ui-designer.md` | Visual system, tokens, components | Visual debt after IA decided |

`source-*.md` = raw upstream personalities (reference). **Prefer the project wrappers.**
Full clone (local only, gitignored): `vendor/agency-agents/`. See `SOURCE_LOCATION.md`.

---

## How we customize (wrapper pattern)

Upstream agency-agents files are **personalities + general craft**. We do **not** edit `vendor/`.

We wrap them in `docs/agents/uiux/<role>.md` with three layers:

```text
┌─────────────────────────────────────────┐
│ 1. Product lens (this product only)     │  job, non-goals, primary user
│ 2. Non-negotiables (stream-first, etc.) │  hard fail conditions
│ 3. Spawn contract (I/O this run)        │  evidence in, report out
└─────────────────────────────────────────┘
         ↑ points at, never copies forever
┌─────────────────────────────────────────┐
│ vendor/agency-agents/design/*.md        │  craft / personality (reference)
└─────────────────────────────────────────┘
```

| Layer | Put here | Do not put here |
|-------|----------|-----------------|
| Wrapper (`docs/agents/uiux/*.md`) | Product job, stream-first rules, design refs, file paths, Chinese output shape | Generic CSS essays, full upstream dump |
| `source-*.md` | Slim upstream personality if useful offline | Product-specific rules |
| `vendor/agency-agents/` | Read-only craft reference | Product edits (never commit) |

**How to customize:** edit wrappers (and this README). If a rule is durable for 红鲱鱼, put it in the matching wrapper's **Non-negotiables**. Longer recipe: `CUSTOMIZE.md`.

---

## How parent should spawn (Grok)

1. **Evidence first.** Playwright (or live browser): home → paste claim → investigating stream → report/share. Save screenshots + a11y snapshot. Paths go into the child brief.
2. **Load wrapper body** from `docs/agents/uiux/<role>.md` (not only the frontmatter title).
3. **`spawn_subagent`** with type `general-purpose` or `critic`:
   - Paste the **full wrapper** as the role contract.
   - Attach: evidence paths, optional prototype path, optional component paths, the exact question for this wave.
4. **Parallel when independent.** Typical critique wave: architect + finish-gate + persona at once; designer after IA is settled (or parallel if only tokens/spacing).
5. **Parent synthesizes** into one `docs/uiux-audit/YYYY-MM-DD-*.md` (or `docs/uiux-audit-YYYY-MM-DD.md`) with P0–P2. Children do not invent a second product.

### Spawn brief skeleton (copy into child)

```text
Role: <paste docs/agents/uiux/<wrapper>.md body>

Evidence (must open):
- screenshots: <paths>
- a11y / notes: <path>
- live URL if any: <url>

Product refs (read if needed):
- docs/PRODUCT_SPEC.md (job only)
- docs/uiux-audit/2026-08-06-kimi-cluster-prototype.html (approved IA skin)
- mvp/src/components/v3/phases/MissionControlView.tsx (process UI)

Done when: Chinese report matching the wrapper Output section; cite path or screenshot for every finding.
Do not implement code unless parent explicitly asked.
```

---

## Product lens (do not invent another product)

- **Job**: 用户粘贴可疑说法 → 看懂证据链 → 决定信不信 / 转不转。
- **Not job**: 展示工程有多牛、Agent 名字有多炫、指标面板有多满、SSE/内部总线全喷脸上。
- **Primary user**: 普通中文用户（媒体消费者 / 家人群里转发），非 MLOps 工程师。
- **UI model**: **stream-first process UI** (Kimi-like progressive stream), **not** an agent ops console.

### Approved design references (structure ≠ skin)

| Layer | Steal | Do not steal |
|-------|--------|--------------|
| Structure / IA | Kimi 集群：主栏 Phase 叙事 → 动作/结果计数 → 人×任务可点 → 右栏明细 → 产物独立 | 12 子 Agent 硬凑、旅行调研业务皮 |
| Skin / tokens | shadcn-admin (oklch, card/badge density, light admin shell) | Their app IA |
| Restraint | arlan vault quiet density | Decorative vault cosplay |
| Status | orbs-style subtle dots | Loud spinners / fake progress theater |

Prototype (proposal only until product authorized):  
`docs/uiux-audit/2026-08-06-kimi-cluster-prototype.html`

---

## Stream-UX critique checklist

Use on every investigating / Mission Control review. Fail any hard item → P0 or HOLD.

**Progressive disclosure**

- [ ] First fold answers: 在查什么 / 现在到哪一步 / 我能不能先走（或必须等）
- [ ] Detail is **click-to-open**, not a wall of every tool call and model id
- [ ] Completed phases collapse; active phase is obvious
- [ ] Verdict / 转不转 is not buried under stream noise when ready

**Human labels (中文用户可见文案)**

- [ ] Phase and step names are plain Chinese job language (理解 / 对照 / 整理…), not `orchestrator`, `minimax:…`, raw provider ids
- [ ] Tool/result chips read as **用户动作结果**（如「检索公开材料 · n 条」）, not RPC method names
- [ ] Error and wait copy say what the human should do next

**No provider / ops wall**

- [ ] No default surface that looks like Datadog / agent fleet / token dashboard
- [ ] Model/provider strings are secondary or hidden; never the hero
- [ ] Metrics (完成 n · 运行 m · 事件 k) support the narrative; they do not replace it
- [ ] Transparency ≠ dumping SSE / internal bus onto the main column

**Stream-first (events over time)**

- [ ] UI assumes events **appear over time**, not a static filled form
- [ ] Distinct visual grammar for: thought / tool / agent handoff / evidence hit / verdict
- [ ] Running vs done states differ (prototype pattern: stream-running / stream-done)
- [ ] Clicking a person/step scopes the right rail to **that** step, not the whole run

**Trust for share decision**

- [ ] Within ~10–30s of meaningful progress, user can form: 真 / 假 / 未知 + 凭什么
- [ ] Sources are openable; "同源转载" style honesty beats fake multi-source majority
- [ ] Share / don't-share outcome is a first-class object, not a chat afterthought

---

## How to run a critique wave

1. Parent: Playwright real path (home → mission → report), screenshots + a11y snapshot.
2. Spawn 3× (architect, finish-gate, persona) with wrapper body + evidence paths; designer when visual system is the question.
3. Parent: synthesize into one audit doc with P0–P2; map findings to components under `mvp/src/components/v3/` when recommending fixes.
4. Do **not** change product TSX until human authorizes (prototype may lead).

---

## Files map

| Path | Commit? |
|------|---------|
| `docs/agents/uiux/*.md` (wrappers, README, CUSTOMIZE) | Yes |
| `docs/uiux-audit/*` | Yes (audits / prototypes) |
| `vendor/agency-agents/` | **No** (gitignored) |

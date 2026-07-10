# Handoff: Attention Guidance + Fact-desk writing (2026-07-10)

## Session outcome

This session entered **红鲱鱼与枪** development around two product threads:

1. **注意力引导 (Attention Guidance)** for evidence reading
2. **核查台写作声音 (Fact-desk voice)** with reusable prompts and live handoff post-process

Public product: https://gun.yishuziyu.cn  
Branch at handoff: `main`

---

## Product decisions (locked)

| Decision | Status |
| --- | --- |
| Change **A** - conclusion as highlighter spans | **Shipped** |
| Change **B** - inline **source chips** (outward citations) | **Shipped / keep** |
| Change **C** - Attention Rail UI | **Removed** (tried, product rejected for now) |
| Change **D** - can say / cannot say boundary columns | **Shipped** (no trailing 可说/不可说 badges) |
| Pseudo-human UI labels (句尾「可说/不可说」) | **Forbidden** - highlighter + section titles only |
| Writing voice | AFP plain + Full Fact uncertainty + 较真 brevity |
| Live handoff JSON | Post-process with Prompt **A+F** after ReportComposer |

Collaboration preference (durable for this user):

- Visual-first for UI: annotated HTML panel before large code UI rewrites
- Non-English user prompts: optimize into English working input, reason in English, reply in Chinese
- Prompt-efficiency framework from `~/Desktop/即时学习/你没活干吗_提示词怎么写/transcript.md`

---

## What shipped (code)

### Attention Guidance

| Path | Role |
| --- | --- |
| `docs/ATTENTION_GUIDANCE.md` | Product spec: definition, 3 layers, schema, BDD |
| `docs/attention-guidance-*.html` | Visual MVP / preview panels |
| `mvp/src/lib/schemas.ts` | `ClaimSpan`, `BoundarySpan`, `AttentionGuidedText`, … |
| `mvp/src/lib/attentionGuidance.ts` | Span split/classify, source attach (B), rail builder (data only) |
| `mvp/src/lib/attentionGuidance.test.ts` | Unit tests |
| `mvp/src/components/v3/ClaimSpanText.tsx` | Highlighter + source chips |
| `mvp/src/components/v3/ConclusionDockV3.tsx` | Wired A/B/D into conclusion dock |
| `mvp/src/styles.css` | Span highlighter + source-chip styles |

**Not shown in UI:** Attention Rail (C). Data may still be computed; do not re-surface without product OK.

### Fact-desk writing

| Path | Role |
| --- | --- |
| `docs/FACTCHECK_WRITING_VOICE.md` | Research distillation + prompts A–F |
| `docs/DEMO_FACTDESK_3CASES.md` | Offline demo on 3 rumor cases (all 12/12 rubric) |
| `mvp/src/lib/factDeskWriter.ts` | Deterministic Prompt A + F for `composeReport` |
| `mvp/src/lib/factDeskWriter.test.ts` | Rubric + drama strip + 3 cases |
| `mvp/src/lib/factDeskDemo.dump.test.ts` | Regenerates `DEMO_FACTDESK_3CASES.md` |
| `mvp/src/lib/reportComposer.ts` | Uses fact-desk lede + case-native boundaries |
| `mvp/src/lib/agentConfigs.ts` | `report_composer` system prompt includes A+F |
| `mvp/server/src/lib/factDeskPostProcess.ts` | **Live** handoff JSON post-process |
| `mvp/server/src/lib/factDeskPostProcess.test.ts` | Server unit tests |
| `mvp/server/src/handlers.ts` | orchestrate + stream + fallback apply post-process |
| `mvp/server/src/lib/agentConfigs.ts` | Server ReportComposer A+F prompt rules |
| `mvp/vite.config.ts` | Local middleware orchestrate paths also post-process |

Live reports gain:

```json
"_factDeskPostProcess": {
  "applied": true,
  "notes": ["…"],
  "version": "A+F-2026-07-10"
}
```

---

## Architecture notes

```text
Demo offline:
  DemoCase → gradeAll → composeReport
    → factDeskWriter (A+F)
    → attentionGuidance (spans + chips)
    → ConclusionDock render

Live handoff:
  rumor → fact + source → report_composer (LLM)
    → formula credibilityScore
    → factDeskPostProcess (A+F)
    → client finalReport
```

**Known debt:** `graderRules.ts` allowed/blocked text is still heavily AI-jobs-domain. Fact-desk paths filter off-domain strings and prefer `routes.minimumOutputRule` / `mustNotInfer`. Long-term: domain-general grader language.

---

## How to verify

```bash
cd mvp
npm test -- src/lib/attentionGuidance.test.ts src/lib/factDeskWriter.test.ts src/lib/v2-e2e.test.ts
npx vitest run server/src/lib/factDeskPostProcess.test.ts server/src/handlers.reportFallback.test.ts
cd server && npx tsc --noEmit
```

Manual:

1. Open conclusion dock on a demo case - highlighters + green source chips, no 可说 badges, no right-side rail
2. Run live `/api/agent/orchestrate` - check `finalReport._factDeskPostProcess.applied`
3. Skim `docs/DEMO_FACTDESK_3CASES.md` for voice sample

---

## Intentionally not done

- Change C Attention Rail re-enable
- Source chip → full EvidenceDetailDrawer deep link (v1 only surfaces source name in action message)
- Domain-general rewrite of `graderRules` inference allow/block strings
- DSPy auto-optimization of prompts (framework documented only)
- Production deploy of this branch (commit/push only unless ops run)

---

## Suggested next sessions (priority order)

1. **Chip → drawer:** click source chip opens EvidenceDetailDrawer / source inspector
2. **Generalize grader** allow/block language per rumor type (health / policy / tech)
3. **Harden live post-process** with golden LLM fixtures (good vs drama outputs)
4. **Optional:** re-open Change C only if product still wants “先看这 3 处” after B stabilizes
5. Deploy to gun.yishuziyu.cn when ready (`./ops.sh` paths in README)

---

## Key docs index

- `docs/ATTENTION_GUIDANCE.md`
- `docs/FACTCHECK_WRITING_VOICE.md`
- `docs/DEMO_FACTDESK_3CASES.md`
- `docs/attention-guidance-mvp-panel.html` (annotated collaboration style)
- This file: `docs/HANDOFF_2026-07-10_ATTENTION_FACTDESK.md`

---

## Resume prompt (paste for next agent)

```text
Continue 红鲱鱼与枪 from docs/HANDOFF_2026-07-10_ATTENTION_FACTDESK.md.
Attention A/B/D shipped; C rail removed; fact-desk A+F on composeReport + live handoff post-process.
Prefer visual HTML panels for UI changes; no pseudo-human 可说/不可说 badges.
Next: source chip → EvidenceDetailDrawer, or domain-general grader language.
```

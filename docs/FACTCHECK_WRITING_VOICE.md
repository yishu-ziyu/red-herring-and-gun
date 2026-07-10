# Fact-check writing voice (distilled)

> Status: research distillation for 红鲱鱼与枪  
> Date: 2026-07-10  
> Purpose: reusable prompts for conclusion / report / can-say copy  
> Not a full academic review. Sources are public style guides, IFCN norms, and major desk practices.

---

## 1. Why this exists

Product conclusion text should sound like a **professional fact desk**, not like:

- marketing hype
- moral lecture
- AI self-commentary ("可说/不可说" stickers)
- courtroom drama

This note distills how leading fact-check operations write, then turns that into prompts we can drop into report composer, handoff rewrite, and future LLM steps.

---

## 2. Who we looked at

| Org / stream | What to steal |
| --- | --- |
| **AFP Fact Check** (Stylebook) | Plain, short, every claim shown true; no puns/irony; transparent method |
| **Snopes** | Explicit **Claim** box; rating + evidence; urban-legend clarity |
| **PolitiFact** | Claim in title; Truth-O-Meter; graded truth, not binary only |
| **Full Fact (UK)** | Public data first; careful on attribution claims; uncertainty when primary source is slow |
| **Les Décodeurs / European desks** | Some moved **off** crude true/false meters toward longer "why" explanations |
| **Washington Post Fact Checker** | Pinocchio scale for *degrees* of stretch, not only true/false |
| **腾讯较真** | Short card: claim + verdict label + checker; mobile-first clarity |
| **中国互联网联合辟谣 / 国内辟谣流** | Authority-forward, action phrases (不信谣不传谣); less "we investigated" first person |
| **有据 / 独立中文核查传统** | Prefer "事实核查" over politicized "辟谣"; rational, sourced, not entertaining |

Cross-org research also finds: most serious desks share **claim → evidence → rating/nuance → what we still do not know**.

---

## 3. Shared craft rules (distilled)

### 3.1 Voice

1. **Straightforward, not colorful.** AFP: no need for colourful language; avoid puns/irony that fail across languages and cultures.
2. **Show work.** Every material fact should be checkable by the reader via sources, quotes, or documents - not "trust us".
3. **Concise.** Extra claim = extra proof. Cut filler.
4. **Separate claim from judgment.** First restate what people said; then what the evidence supports.
5. **Prefer precision over drama.** "No public record of this order" beats "纯属捏造、震惊全网".
6. **Name uncertainty.** If primary source has not confirmed, say so. Unproven is a valid state (AAP-style *Unproven* / Full Fact caution on attribution).
7. **Do not mind-read motives.** Check the statement, not the speaker's soul (IFCN fairness spirit).
8. **One claim unit at a time.** Complex sentences get split; one rating per atomic claim when possible.

### 3.2 Structure (almost universal)

```text
1. Claim (exact or carefully paraphrased, in context)
2. What we found / current evidence (with links or named sources)
3. Rating or boundary language (true / false / mixed / unproven / misleading)
4. What still cannot be said (gaps, blocked inferences)
5. Next evidence that would change the conclusion (optional)
```

### 3.3 What good desks avoid

| Avoid | Why |
| --- | --- |
| Sarcasm, meme tone, dunking | Undermines trust; fails translation |
| "Everyone knows" | Snopes/media literacy red flag |
| Stacking adjectives: 极其离谱、可笑至极 | Entertainment, not verification |
| Collapsing 5 claims into one "假" | European desks warn complexity needs nuance |
| Inventing quotes or paraphrasing into stronger claims | Creates new falsehoods |
| Pseudo-human UI labels in prose | Product taste: no self-narrating 可说 chips in body |

### 3.4 Chinese product positioning for 红鲱鱼与枪

We are closer to **AFP + Full Fact + 较真卡** than to:

- PolitiFact comedy meter ("Pants on Fire") as default voice
- Domestic 口号体 alone ("共筑清朗") as body copy

Recommended blend:

- **Body:** AFP plain + Full Fact uncertainty  
- **Card/headline:** 较真-style short claim + calm verdict  
- **Boundary:** our can-say / cannot-say (structural, not sentence-end badges)  
- **Citations:** Snopes/ChatGPT-like outward source chips (Change B)

---

## 4. Phrase bank (copy texture)

### 4.1 Claim framing

- 流传说法是：「…」
- 原表述把 A、B、C 压成一句，需要拆开核。
- 这句话里真正可核查的部分是：…

### 4.2 Evidence

- 目前能核对到的公开材料显示…
- 根据 [来源名] 在 [时间] 的说明…
- 检索范围内未见可验证的原始文件 / 官方文本。
- 多篇转载内容可追溯到同一上游，不能算作多源独立证实。

### 4.3 Verdict / boundary

- 就现有证据，**不能支持**「…」这一说法。
- 更稳妥的表述是：…
- 这部分属于**证据不足**，不是已证实，也还不到可判定为故意造假。
- 可以说：…；不能推出：…

### 4.4 Uncertainty

- 在主管部门书面回应前，只能写「尚未证实」。
- 数据口径不一致时，不能直接比较并写成「已经下降」。
- 时间顺序缺失时，不能使用「导致」。

### 4.5 Action without lecture

Prefer:

- 转发前建议先看原始来源。

Avoid:

- 广大网友务必理性、不要当帮凶。

---

## 5. Reusable prompts

### Prompt A - Conclusion rewrite (primary)

Use for: `reportComposer` cautious conclusion, handoff conclusion, public-facing rewrite.

```text
You are a fact-desk writer for a Chinese product called 红鲱鱼与枪.

Task: rewrite the verification result into user-facing Chinese prose.

Inputs:
- original_claim
- atomic_findings (list of {claim_unit, evidence_summary, sources[], status: support|contradict|gap|blocked})
- can_say[]
- cannot_say[]
- next_evidence_needed[]

Writing rules (non-negotiable):
1. Voice: plain, precise, adult. Like AFP Fact Check + Full Fact. No sarcasm, no meme tone, no moral lecture.
2. Structure the conclusion as 2–5 short sentences max for the lede:
   - what the claim said
   - what evidence currently supports or denies
   - what remains unproven or blocked
3. Every hard factual clause must be supportable by a named source in inputs. If no source, mark as gap language (无法/未见/不足以), never as proven fact.
4. Never invent sources, dates, officials, or quotes.
5. Prefer "不能支持 / 不足以确认 / 未见公开记录" over "纯属捏造 / 可笑 / 震惊".
6. Keep can_say and cannot_say boundaries honest. Do not smuggle a cannot_say idea into assertive wording.
7. Chinese: fullwidth punctuation, short sentences, no English filler, no AI self-talk ("作为AI").
8. Do not append meta labels like 「可说」「不可说」 inside the prose. Boundaries are separate lists.
9. Output JSON:
{
  "lede": string,
  "can_say": string[],
  "cannot_say": string[],
  "open_questions": string[]
}
```

### Prompt B - Claim restatement (before scoring)

```text
Restate the user's material as one or more checkable claims.

Rules:
- Quote or carefully paraphrase; do not strengthen the claim.
- Split compound claims (quantity + mechanism + causality) into atomic units.
- Flag ambiguous terms that block direct true/false judgment.
- Output only the claim units and ambiguity notes. No verdict yet.
```

### Prompt C - Evidence sentence with citation hooks

```text
For each atomic claim unit, write one evidence sentence in Chinese.

Rules:
- Start from what the source actually says, not what we wish it said.
- Attach source_ids that justify the sentence.
- If sources conflict, say both sides in one or two sentences; do not average them into fake consensus.
- If only reposts of one upstream exist, say "同源转载，不能算多源证实".
- No adjectives of outrage.
```

### Prompt D - Boundary lists (can say / cannot say)

```text
Produce can_say and cannot_say lists.

Rules:
- can_say: statements the evidence currently licenses, in cautious Chinese.
- cannot_say: inferences blocked by gaps, independence failures, or logic.
- cannot_say items must never be rewritable into can_say by tone change alone.
- Each item one sentence, no rhetorical questions, no "请广大网友".
- Max 6 items per list.
```

### Prompt E - Short share card (较真-like)

```text
Write a mobile card:

标题: [claim, ≤28 chars if possible]
判定: [高度可疑 | 存疑 | 部分属实 | 基本属实 | 证据不足]  (pick one; no comedy labels)
一句话: [≤40 chars, plain]
依据: [1–3 source short names]

No hashtags, no emoji spam, no "速来围观".
```

### Prompt F - Self-critique Loop (after first draft)

```text
Review the draft against this checklist. Fix only failing lines.

[ ] Any sentence asserts a fact without a source hook?
[ ] Any cannot_say content written as if true?
[ ] Any sarcasm, dunking, or moralizing?
[ ] Any compound claim still fused that should be split?
[ ] Any "导致/已经/证明" used without mechanism + data?
[ ] Would a skeptical reader find the source trail without trusting the author?

Return revised lede + lists only.
```

---

## 6. Scoring rubric for DSPy / eval (optional)

Score 0–2 each; pass if total ≥ 10/12:

1. Claim faithfully restated (not strengthened)
2. Evidence language matches sources
3. Uncertainty visible where needed
4. No banned drama diction
5. Boundaries consistent with can/cannot
6. Concise (lede ≤ 120 Chinese chars preferred for dock)

---

## 7. Wire-in map (product)

| Surface | Prompt |
| --- | --- |
| Conclusion dock lede | A (+ F loop) |
| can say / cannot say | D |
| Inline source chips (Change B) | C supplies source_ids; UI renders chips |
| Export / 辟谣卡片 | E |
| Mission report body | A expanded to short sections |

Change C Attention Rail: **removed from UI** (product decision 2026-07-10). Keep data optional; do not surface.

---

## 8. Anti-patterns library (reject in review)

- "纯属子虚乌有，令人啼笑皆非"
- "智慧的网友一眼识破"
- "铁证如山，毋庸置疑" (when evidence is thin)
- "作为人工智能，我… "
- Stacking five true details to smuggle one false causal leap
- Using 10 repost links as "多方证实" without lineage fold

---

## 9. Decision log

| Date | Decision |
| --- | --- |
| 2026-07-10 | Keep Change B source chips; remove Change C rail from UI |
| 2026-07-10 | Writing voice = AFP plain + Full Fact uncertainty + 较真 card brevity |
| 2026-07-10 | Distill prompts A–F for composer / handoff / export |
| 2026-07-10 | Wired Prompt A+F into `factDeskWriter.ts` + `composeReport` + `report_composer` systemPrompt; demo 3 cases in `docs/DEMO_FACTDESK_3CASES.md` |
| 2026-07-10 | Live handoff JSON post-process: `server/src/lib/factDeskPostProcess.ts` on orchestrate + stream (handlers + vite middleware) after formula score |

---

## 10. Sources (entry points)

- AFP Fact-Checking Stylebook (writing: straightforward, evidence, concise; avoid puns/irony)
- Snopes / PolitiFact claim + rating patterns (public sites + academic comparisons)
- Full Fact practice notes on attribution uncertainty and transparency criteria
- Reuters Institute: European fact-check meters vs narrative explanations (Les Décodeurs shift)
- IFCN-oriented norms: transparency, fairness, non-partisanship (via secondary summaries)
- 腾讯较真 card UX; 中国互联网联合辟谣 platform role (authority-forward, not our default body voice)
- Commentary on Chinese "辟谣" politicization vs "事实核查" framing (e.g. independent Chinese checkers' preference)

When implementing prompts in code, prefer linking this file path rather than re-pasting long essays into every call.

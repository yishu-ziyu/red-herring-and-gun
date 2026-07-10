# 注意力引导（Attention Guidance）

> Status: draft for alignment  
> Product: 红鲱鱼与枪  
> Date: 2026-07-10  
> Related: evidence chain, sourceLineage, inferenceLicense, recursive search (v7)

---

## 1. Definition

**Attention Guidance** is a first-class product capability:

> While the user reads a conclusion or reviews evidence, the system decides what they should notice first, binds every verifiable assertion to its sources, and surfaces the gaps they still need.

It is **not** a footer bibliography.  
It is **not** a raw dump of every search hit.  
It is **guided reading of truth claims**.

Core product sentence stays true:

> 先别转发，先看证据链。

Attention Guidance turns that sentence into interaction:

```text
Read one claim span
  -> see its sources inline
  -> see why it ranks in attention order
  -> see missing evidence if any
  -> choose whether to dig deeper (frontier / recursive search)
```

---

## 2. Problem

### 2.1 User problem

After a multi-agent check, the user still faces:

1. A conclusion that looks authoritative, but they cannot tell which sentence rests on which source.
2. A pile of evidence cards with equal visual weight, so the critical counter-evidence or "fake majority" is easy to miss.
3. No clear next move when evidence is incomplete.

### 2.2 Product gap today

| Existing | What it does well | What is still missing |
| --- | --- | --- |
| EvidenceChain / EvidenceDetailDrawer | Card and drawer level provenance | Sentence-level binding in conclusion text |
| sourceLineage | 10 reposts != 10 independent sources | Independence signal not shown at the moment of reading |
| inferenceLicense (can say / cannot say) | Report-level license list | Not embedded as inline span markers |
| ReasoningTracePanel | Agent process playback | Not reading-time guidance |
| Recursive search plan (v7) | User chooses next seed | Needs attention ranking for "what to expand next" |

One line:

> Provenance data exists. Attention is not yet owned by the product.

---

## 3. Three-layer mechanism

### Layer 1 - Sentence-level provenance (inline citations)

Every verifiable assertion in conclusion / summary / can-say text carries inline source chips:

- Source name (clickable)
- Evidence role: support / contradict / limit
- Independence after lineage fold
- License: allowed / blocked / missing

Example reading experience:

> 官方未发布该政策 **[新华社 · 支持 · 独立]**，网传文件来源不明 **[缺口 · P0]**。

### Layer 2 - Attention priority (what to look at first)

The system ranks attention targets. It does not treat all evidence as equal.

| Priority | Guide the user to | Why |
| --- | --- | --- |
| P0 | Counter-evidence, official denial, conflicts with conclusion | Highest risk of being wrong if ignored |
| P1 | "Fake majority" after lineage fold | Many links, one upstream |
| P2 | Critical gaps / missing sources | Blocks can-say |
| P3 | Clue-only material (not main evidence) | Easy to over-weight |
| P4 | Background | Default collapsed |

UI principle: show a short **Attention Rail** ("先看这 3 处"), not a flat list.

### Layer 3 - Gap discovery (what they still need)

Beyond "what we found", surface:

- Which evidence type is still missing to promote 存疑 -> 可说
- Which subclaim is still uncovered
- Best next frontier for recursive search (user still chooses)

AI guides attention. User keeps control of expansion.

---

## 4. Span schema

Conclusion and key report text are not plain strings. They are sequences of `ClaimSpan`.

### 4.1 Types

```ts
/** One readable unit in conclusion / can-say / cannot-say text */
export type AttentionPriority = "p0" | "p1" | "p2" | "p3" | "p4";

export type SpanType =
  | "assert"    // factual claim that needs sources
  | "hedge"     // cautious wording, usually no strong source demand
  | "gap"       // explicit missing evidence
  | "blocked"   // cannot infer / cannot say
  | "context";  // glue text, no citation required

export type EvidenceRole = "support" | "contradict" | "limit" | "background" | "missing";

export type IndependenceSignal =
  | "independent"
  | "folded_repost"   // lineage collapsed to one upstream
  | "unknown"
  | "not_applicable";

export type LicenseSignal = "allowed" | "blocked" | "insufficient" | "not_checked";

export interface SourceRef {
  sourceId: string;
  title: string;
  url?: string;
  domain?: string;
  role: EvidenceRole;
  independence: IndependenceSignal;
  /** Canonical group after sourceLineage fold, if any */
  lineageGroupId?: string;
}

export interface ClaimSpan {
  id: string;
  text: string;
  spanType: SpanType;
  sourceIds: string[];
  sources?: SourceRef[];
  attention: AttentionPriority;
  role?: EvidenceRole;
  license?: LicenseSignal;
  /** Subclaim this span belongs to */
  subclaimId?: string;
  /** Why this span is ranked at this priority (short, user-readable) */
  attentionReason?: string;
  /** What evidence would resolve a gap span */
  neededEvidence?: string[];
}

export interface AttentionTarget {
  id: string;
  spanId: string;
  priority: AttentionPriority;
  title: string;
  reason: string;
  actionHint?: string; // e.g. "open counter-evidence", "expand frontier"
}

export interface AttentionGuidedText {
  plainText: string;
  spans: ClaimSpan[];
  attentionRail: AttentionTarget[]; // sorted p0 -> p4, usually top 3 surfaced
  sources: SourceRef[];
}
```

### 4.2 Composition rules

1. Every `assert` span must have >= 1 `sourceId`, or become `gap` / `blocked`.
2. `blocked` spans map to `inferenceLicense.inference_blocked` items.
3. `gap` spans map to missing sources or uncovered subclaims.
4. Lineage fold happens before independence is shown on chips.
5. Attention rank is deterministic from signals (conflict, fold, gap, clue-only), not free-form LLM ranking alone.
6. UI may hide P4 by default; P0-P2 must be reachable in one click from the rail.

### 4.3 Data flow (reuse existing modules)

```text
search results
  -> sourceLineage.fold
  -> evidenceConsensus / graded evidence
  -> inferenceLicense aggregate
  -> reportComposer produces AttentionGuidedText
  -> ConclusionDock / Report render spans + Attention Rail
  -> click chip -> EvidenceDetailDrawer (existing)
  -> click gap / frontier -> recursive search entry (v7)
```

No new architecture branch. Extend report composition and conclusion surface.

---

## 5. UX surfaces (v1)

| Surface | What appears | Priority for first ship |
| --- | --- | --- |
| ConclusionDock summary | Inline chips on conclusion sentences | P0 ship |
| Attention Rail | "先看这 3 处" beside conclusion | P0 ship |
| can say / cannot say lists | Span markers + license chips | P1 |
| EvidenceDetailDrawer deep-link | Opened from chip click | P0 ship (reuse) |
| Mission report export (Markdown) | Inline `[source]` footnotes | P2 |
| Canvas node Inspector | Attention hints on node claims | Later (align v7) |

Visual collaboration note: UI changes for this feature should be proposed via an annotated panel (HTML mock with arrows) before large code rewrites. See collaboration rule below.

---

## 6. Acceptance BDD

### Behavior 1: Inline source on assert spans

**Given** a finished verification with at least one supported claim in the conclusion  
**When** the user opens the conclusion panel  
**Then** each `assert` span shows an inline source chip with name and openable URL when available.

Business rule: users must not guess which sentence rests on which source.

### Behavior 2: Missing source becomes gap, not fake certainty

**Given** a conclusion sentence that has no usable source  
**When** the report is composed  
**Then** that span is typed `gap` or `blocked`, ranked at least P2 (P0 if it carries the main claim), and is listed on the Attention Rail.

Business rule: no uncited hard assert in the final user-facing conclusion.

### Behavior 3: Counter-evidence ranks above supportive noise

**Given** both support and contradict sources for the same subclaim  
**When** Attention Rail is built  
**Then** at least one contradict / conflict target appears at P0 before background support items.

Business rule: attention protects against confirmation bias.

### Behavior 4: Lineage fold prevents fake majority

**Given** five media URLs that fold to one upstream group  
**When** chips and independence signals render  
**Then** the UI shows one independent group (or "转载折叠"), not five independent supports.

Business rule: 10 reposts != 10 independent proofs.

### Behavior 5: Click chip opens provenance, not a dead badge

**Given** an inline chip with a valid `sourceId`  
**When** the user clicks the chip  
**Then** EvidenceDetailDrawer (or equivalent) opens on that source / proposition context.

Business rule: citation is a navigation action, not decoration.

### Behavior 6: Gap suggests next evidence, does not auto-run forever

**Given** a `gap` span with `neededEvidence`  
**When** the user views the Attention Rail item  
**Then** they see a short "你还需要什么" hint and an optional entry to recursive search / frontier  
**And** the system does not auto-expand deeper layers without user action.

Business rule: AI guides; user decides whether to dig.

### Behavior 7: can-say / cannot-say remain honest

**Given** inferenceLicense contains blocked inferences  
**When** conclusion text is rendered  
**Then** blocked content appears as `blocked` spans (or in cannot-say), never rewritten into assertive `assert` spans with fake sources.

Business rule: license constraints survive the pretty UI.

### Behavior 8: Demo path is verifiable without live network

**Given** existing demo / golden case data  
**When** the v1 Attention Guidance path runs offline  
**Then** AttentionGuidedText can be produced and rendered with >= 1 P0 target and >= 1 inline chip.

Business rule: product demo must not depend on flaky search.

---

## 7. Non-goals (v1)

- Full automatic fact-check of every token in long free text outside the report pipeline
- Replacing Evidence Matrix / Canvas architecture
- Auto multi-hop recursive search without user clicks
- Citation styles for academic paper export (APA/MLA) as a first-class goal
- Training a new model; this is composition + UI + ranking

---

## 8. Success metrics (product, not vanity)

| Signal | Pass bar for v1 review |
| --- | --- |
| Uncited assert in conclusion | 0 on demo cases |
| Attention Rail empty when conflicts/gaps exist | Never |
| Chip click dead-end | 0 |
| Time to find a contradict source from conclusion | Under 2 clicks in walkthrough |
| User can answer "why can we say X?" from the panel | Yes, without opening raw agent logs |

---

## 9. Implementation slices

### Slice A - Data contract

- Add `ClaimSpan` / `AttentionGuidedText` to `mvp/src/lib/schemas.ts` (or adjacent types module)
- Unit tests for composition rules 1-5

### Slice B - Composer

- `reportComposer` (or thin adapter) emits `AttentionGuidedText` from graded evidence + lineage + license
- Deterministic attention ranker (pure function, fully tested)

### Slice C - Conclusion UI

- Render spans + chips in ConclusionDock
- Attention Rail "先看这 3 处"
- Chip -> EvidenceDetailDrawer

### Slice D - Export

- Markdown export keeps source anchors

---

## 10. Collaboration rule for this feature (visual first)

For Attention Guidance UI (and preferred for other visual work on this product):

1. Before large UI code changes, render an **MVP panel** (HTML mock or equivalent).
2. On that panel, show the proposed look.
3. Mark change targets with **arrows + short labels** on the same surface.
4. Align with the user on the panel, then implement.

This keeps product review visual, not abstract.

---

## 11. Open questions

1. First entry surface: ConclusionDock only, or also Mission report modal?
2. Chip density: always-on for every assert, or progressive disclosure for long conclusions?
3. Should Attention Rail be sticky during scroll?
4. Who wins on conflict: human-authored demo narrative vs automatic ranker?

Default recommendation until decided:

- Entry: ConclusionDock first
- Density: always-on chips for assert/gap/blocked; collapse P4
- Rail: sticky in dock
- Ranker: automatic signals first; demo data can pre-seed expected P0s

---

## 12. Decision log

| Date | Decision |
| --- | --- |
| 2026-07-10 | Name capability **注意力引导 / Attention Guidance** |
| 2026-07-10 | Three layers: inline provenance, attention priority, gap discovery |
| 2026-07-10 | v1 ship order: schema -> composer -> ConclusionDock + Rail |
| 2026-07-10 | Visual-first collaboration for UI changes |
| 2026-07-10 | User prioritized **Change A + Change D** first (skip B chips and C rail UI for now) |
| 2026-07-10 | Implemented: `ClaimSpan` schema, `attentionGuidance.ts`, ConclusionDock span render, boundary tags; blocked never masquerades as assert |
| 2026-07-10 | Taste: remove pseudo-human trailing 可说/不可说 badges; highlighter only |
| 2026-07-10 | User asked to try **Change B + C**; keep if good, roll back if not |
| 2026-07-10 | Implemented B source chips (outward citations) + C Attention Rail (top 3, human titles) |
| 2026-07-10 | Product: **keep B, drop C** from UI |
| 2026-07-10 | Writing style research distilled to `docs/FACTCHECK_WRITING_VOICE.md` (prompts A–F) |

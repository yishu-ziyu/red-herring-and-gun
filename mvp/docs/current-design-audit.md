# 真探 Agent (Truth Hunter) — 设计审计报告

> 审计日期：2026-05-30
> 审计范围：`src/styles.css` (5496 lines), `Dashboard.tsx`, `AgentCard.tsx`, `ReportPanel.tsx`, `index.html`

---

## 1. Current Color System

### 1.1 CSS Variables in `:root`

The project uses a **"Variant B"** color system declared in `:root` (lines 1-65). Below is the complete inventory:

#### Neutral / Foundation Colors
| Variable | Value | Purpose |
|----------|-------|---------|
| `--ink-black` | `#0a0a0f` | Deepest dark; used for toast backgrounds, canvas dark mode bg, high-contrast text |
| `--charcoal` | `#1d1d1f` | Primary text color; brand block text; body default color |
| `--steel` | `#4a4a4f` | Secondary text; label-box color |
| `--silver` | `#86868b` | Tertiary text; meta labels; placeholder-like text |
| `--cloud` | `#f5f5f7` | Body background (`--bg-body`); dashboard bg; reasoning workspace bg |
| `--paper` | `#ffffff` | Panel/card backgrounds; elevated surfaces |
| `--border-subtle` | `#e5e5e7` | Default borders for cards, panels, inputs |
| `--border-medium` | `#d1d1d6` | Stronger borders; dashed empty states; divider lines |

#### Semantic / Theme-Mapped Colors
| Variable | Maps To | Purpose |
|----------|---------|---------|
| `--bg-body` | `--cloud` | Page background |
| `--bg-panel` | `--paper` | Card/panel backgrounds |
| `--bg-elevated` | `#fafafa` | Slightly elevated surfaces (input bg, hover bg, inner cards) |
| `--text-primary` | `--charcoal` | Headings, body text |
| `--text-secondary` | `--steel` | Descriptions, labels, secondary copy |
| `--text-tertiary` | `--silver` | Meta text, timestamps, hints |

#### Accent Colors
| Variable | Value | Purpose |
|----------|-------|---------|
| `--accent-blue` | `#2563eb` | Primary action color; focus rings; active pills; links; agent-fact |
| `--accent-green` | `#16a34a` | Success; credibility-good; agent-report; completed states |
| `--accent-amber` | `#d97706` | Warning; running states; timeline progress; credibility-medium |
| `--accent-red` | `#dc2626` | Error; danger buttons; agent-rumor; credibility-critical |
| `--accent-purple` | `#7c3aed` | Agent-source; sherlock search; secondary accent |

#### Agent-Specific Colors (Desaturated)
| Variable | Value | Agent |
|----------|-------|-------|
| `--agent-rumor` | `#b45309` | Rumor Detector |
| `--agent-fact` | `#2563eb` | Fact Checker |
| `--agent-source` | `#7c3aed` | Source Validator |
| `--agent-report` | `#16a34a` | Report Composer |

#### Credibility Scale
| Variable | Value | Score Range |
|----------|-------|-------------|
| `--credibility-high` | `#15803d` | >= 80 |
| `--credibility-good` | `#16a34a` | 60-79 |
| `--credibility-medium` | `#d97706` | 40-59 |
| `--credibility-low` | `#ea580c` | 20-39 |
| `--credibility-critical` | `#dc2626` | < 20 |

#### Shadows (Flattened for Variant B)
| Variable | Value |
|----------|-------|
| `--shadow-sm` | `none` |
| `--shadow-md` | `none` |
| `--shadow-lg` | `none` |

**Observation**: Shadows are explicitly disabled at the variable level, but many components still declare `box-shadow` with hardcoded values (e.g., `.canvas-node` has `box-shadow: 0 2px 8px rgba(0,0,0,0.06)`). This creates inconsistency — the design claims "flattened" but doesn't enforce it.

### 1.2 Dark Mode Support

**Partial / Experimental only.**

There is a `.canvas-area--dark` modifier (lines 5351-5378) that inverts canvas colors for a dark background:
- Background becomes `--ink-black`
- Nodes become `--charcoal` with light text
- Grid lines become `rgba(255,255,255,0.04)`

However, **there is no global dark mode toggle** or `prefers-color-scheme` media query for the full application. The dashboard, mission control, and result pages are all light-mode only.

### 1.3 Color Usage Patterns

- **Borders**: Almost exclusively `var(--border-subtle)` (`#e5e5e7`)
- **Focus states**: Blue ring — `box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1)` or `0.08`
- **Status backgrounds**: `rgba(color, 0.04-0.08)` for subtle tinting
- **Hardcoded colors**: Many components use literal hex values instead of variables, especially in:
  - Canvas node status colors (e.g., `#3b82f6`, `#22c55e`, `#f59e0b`)
  - Sherlock search results (e.g., `#dcfce7`, `#fee2e2`)
  - Handoff UI (e.g., `#f8fafc`, `#e2e8f0`, `#1e293b`)

---

## 2. Current Typography

### 2.1 Fonts Loaded (from `index.html`)

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

| Font | Weights | CSS Variable | Usage |
|------|---------|--------------|-------|
| Noto Sans SC | 400, 500, 600, 700 | `--font-sans` | Body text, UI elements, buttons, labels |
| Noto Serif SC | 400, 600, 700 | `--font-serif` | Headings, brand titles, scores, stamps |
| JetBrains Mono | 400, 500 | `--font-mono` | Metadata, timestamps, model names, latency |

### 2.2 How They're Used

The **Variant B override section** (lines 5229-5248) explicitly maps fonts to roles:

```css
/* Serif for headings / display text */
.dashboard-brand-title,
.mission-brand strong,
.mission-agent-card h2,
.result-brand strong,
.conclusion-score,
.conclusion-label,
.truth-stamp-text {
  font-family: var(--font-serif);
}

/* Mono for metadata */
.mission-agent-meta,
.mission-brand span,
.result-brand span,
.handoff-step-meta {
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

**Typographic hierarchy observed:**

| Element | Size | Weight | Font |
|---------|------|--------|------|
| Dashboard brand title | `32px` | 700 | Serif |
| Report claim H1 | `26px` | normal | Sans (inherited) |
| Mission agent card H2 | `24px` | normal | Serif |
| Conclusion score | `48px` | 700 | Serif |
| Conclusion label | `24px` | 600 | Serif |
| Body text | `14-16px` | 400-600 | Sans |
| Meta / timestamps | `11-12px` | 700 | Mono |
| Section labels (uppercase) | `11px` | 700-850 | Sans or Mono |

### 2.3 Typography Issues

1. **Inconsistent heading sizes**: `.node-inspector h2` is overridden to `18px` (line 1429) but other H2s are `24px`. The inspector title was deliberately shrunk for "Linear-inspired density" but this isn't systematically applied.

2. **Font weight 650 / 750 / 850**: Non-standard weights are used throughout (e.g., `font-weight: 650` for buttons, `850` for labels). These fallback to the nearest available weight but may render inconsistently across browsers.

3. **No type scale system**: Font sizes are ad-hoc — `11px`, `12px`, `13px`, `14px`, `15px`, `16px`, `17px`, `18px`, `20px`, `22px`, `24px`, `26px`, `32px`, `36px`, `48px`. There is no modular scale or tokenized type system.

4. **Line-height inconsistency**: `line-height: 1.5` is the default, but headings use `1.1`, `1.15`, `1.18`, `1.28` inconsistently.

---

## 3. Current Spacing

### 3.1 Spacing Variables

```css
--unit: 8px;
--space-xs: 8px;
--space-sm: 12px;
--space-md: 24px;
--space-lg: 48px;
--space-hero: 80px;
```

**Observation**: These variables are **declared but rarely used**. Most spacing is hardcoded. A grep-like scan shows:
- `--space-xs` / `--space-sm` / `--space-md` / `--space-lg` / `--space-hero` appear **zero times** outside the `:root` declaration
- `--unit` is never referenced

### 3.2 Layout Approach

The layout is a **hybrid of CSS Grid and Flexbox**, heavily favoring Grid for macro layouts:

**Grid patterns:**
- Dashboard: `place-items: center` with content width `min(900px, 100%)`
- Reasoning workspace: `grid-template-rows: auto minmax(0, 1fr) auto`
- Workspace grid: `grid-template-columns: 242px minmax(760px, 1fr) 330px`
- Result report: `grid-template-columns: minmax(0, 3fr) minmax(360px, 2fr)`
- Mission control: `grid-template-rows: 48px minmax(0, 1fr) 126px`

**Flexbox patterns:**
- Used for inline arrangements: pill groups, button rows, tag lists
- `gap` is consistently used (modern approach)

**Spacing values observed:**
- Micro: `2px`, `4px`, `6px`
- Small: `8px`, `10px`, `12px`, `14px`
- Medium: `16px`, `18px`, `20px`, `24px`
- Large: `32px`, `36px`, `48px`

**Border radius values:**
- `8px` — small buttons, icons
- `10px` — buttons, tags
- `12px` — cards, panels, inputs
- `14px` — larger cards, agent cards
- `16px` — modal panels, report sections
- `18px` — result panels, claim nodes
- `20px` — workspace panels, main cards
- `24px` — dashboard input card
- `999px` — pills, badges, progress bars (full rounding)

---

## 4. Component Design Patterns

### 4.1 Cards

**Standard card pattern:**
```css
border: 1px solid var(--border-subtle);
border-radius: 16-20px;
padding: 14-24px;
background: #ffffff;
```

**Variants:**
- **Dashboard input card**: `border-radius: 24px`, `padding: 24px`, `background: #ffffff`
- **Mission agent card**: `border-radius: 20px`, `border-top: 4px solid var(--mission-agent-color)`, `background: rgba(255,255,255,0.94)`
- **Report step card**: `border-radius: 14px`, `padding: 14px`, `background: #ffffff`
- **Demo card**: `border-radius: 18px`, `padding: 20px`, hover lifts with `translateY(-1px)`
- **Conclusion card**: `border-radius: 0 12px 12px 0`, `border-left-width: 12px`, thick left border for credibility color

### 4.2 Buttons

**Primary button:**
```css
border: 0;
border-radius: 10px;
padding: 10px 12px;
color: #ffffff;
background: var(--accent-blue);
font-size: 14px;
font-weight: 650;
```

**Secondary button:**
```css
color: var(--text-primary);
background: var(--bg-elevated);
```

**Button variants observed:**
- `.dashboard-submit-btn` — larger, `padding: 12px 28px`, `font-size: 15px`
- `.dashboard-submit-btn--deep` — outlined blue with pulse animation
- `.mission-cancel-btn` — red-tinted, `border: 1px solid rgba(220,38,38,0.2)`
- `.mode-pill` — fully rounded (`999px`), toggle style
- `.conclusion-action-btn` — bordered, hover lift

**Disabled state:**
```css
opacity: 0.46;
cursor: not-allowed;
```

### 4.3 Badges / Labels / Pills

**Pill pattern (used for tags, model selector, mode buttons):**
```css
border: 1px solid var(--border-subtle);
border-radius: 999px;
padding: 4-6px 10-14px;
font-size: 12-13px;
font-weight: 600;
```

**Active pill:**
```css
color: #ffffff;
background: var(--accent-blue);
border-color: var(--accent-blue);
```

**Label-box (Variant B specific):**
```css
border: 1px solid var(--border-medium);
border-radius: 2px;  /* sharp corners! */
padding: 2px 6px;
font-size: 11px;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.05em;
```

**Credibility badge:**
```css
border: 1px solid color-mix(in srgb, var(--credibility-color) 24%, transparent);
background: color-mix(in srgb, var(--credibility-color) 8%, #ffffff);
```
Uses modern `color-mix()` — good progressive enhancement.

### 4.4 Animation Patterns

**Easing functions:**
```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

**Animation types:**

| Animation | Duration | Used For |
|-----------|----------|----------|
| `phase-enter` / `phase-exit` | 300ms | Page transitions |
| `nodeEnter` | 420ms | Canvas node appearance |
| `agent-running-pulse` | 2s infinite | Running agent glow |
| `mission-card-breathe` | 2.4s infinite | Mission card shadow pulse |
| `mission-pulse` | 1.2s infinite | Timeline node pulse |
| `stampIn` | 0.6s spring | Truth stamp appearance |
| `deep-button-pulse` | 2.8s infinite | Deep orchestrate button glow |
| `streaming-pulse` | 1.5s infinite | Handoff streaming indicator |
| `skeleton-breathe` | 1.5s infinite | Loading skeletons |

**Reduced motion support:** Present (lines 5484-5495) — disables animations for `prefers-reduced-motion: reduce`.

---

## 5. Design Strengths

### 5.1 Cohesive "Variant B" Aesthetic
The design has a clear identity: **minimal, flat, editorial**. The intentional removal of shadows (`--shadow-*: none`), the serif/sans/mono triad, and the desaturated color palette all work together to create a serious, journalistic feel appropriate for a fact-checking tool.

### 5.2 Strong Information Hierarchy
- Uppercase letter-spaced labels (`font-size: 11px`, `letter-spacing: 0.08em`, `text-transform: uppercase`) consistently mark section headers
- Color-coded agent system makes it easy to distinguish roles at a glance
- Credibility scoring uses both color and numeric value for accessibility

### 5.3 Thoughtful Micro-interactions
- Hover lift on cards (`translateY(-1px)`) adds tactile feedback
- Focus rings are consistent and visible (`0 0 0 3px rgba(0, 113, 227, 0.1)`)
- Running states have purposeful animations (pulse, breathe) that communicate activity without being distracting
- Truth stamp animation (`stampIn`) adds personality to the result page

### 5.4 Canvas / Visualization Layer
The reasoning canvas with its grid background, layered bands, color-coded nodes, and focus-mode dimming shows sophisticated interaction design. The node status system (risk/supported/limited/blocked/etc.) with top-right dots is a clean, scannable pattern.

### 5.5 Responsive Considerations
Multiple `@media` breakpoints exist:
- `max-width: 1180px` — workspace min-width
- `max-width: 980px` — result layout stacks
- `max-width: 768px` / `max-width: 760px` / `max-width: 620px` — mobile adaptations

### 5.6 Modern CSS Features
- `color-mix()` for credibility badge borders/backgrounds
- `backdrop-filter: blur()` for glassmorphism effects (topbars, floating elements)
- CSS Grid with `minmax()` for fluid layouts
- Custom properties for theming (even if not fully leveraged)

---

## 6. Design Weaknesses / Opportunities

### 6.1 Inconsistencies

**A. Shadow system contradiction**
- Variables declare `--shadow-sm/md/lg: none` (flattened design)
- But components use hardcoded shadows: `.canvas-node` (`0 2px 8px rgba(0,0,0,0.06)`), `.mission-agent-card` (`0 8px 32px rgba(0,0,0,0.12)`), `.dashboard-input-card` (`box-shadow: var(--shadow-lg)` which is `none` — this is actually correct but confusing)
- **Fix**: Either commit to flat design (remove all shadows) or define shadow tokens and use them consistently.

**B. Hardcoded colors everywhere**
Many sections use literal hex values instead of CSS variables:
- Canvas node colors: `#3b82f6`, `#22c55e`, `#f59e0b`, `#a855f7`, etc.
- Sherlock search: `#dcfce7`, `#fee2e2`, `#ffedd5`
- Handoff UI: `#f8fafc`, `#e2e8f0`, `#1e293b`, `#64748b`
- **Fix**: Map these to semantic variables (e.g., `--status-blue`, `--status-green`, `--surface-success`, etc.)

**C. Border radius inconsistency**
Radius values range from `2px` (label-box) to `24px` (dashboard card) with no clear system. At least 8 different values are used.
- **Fix**: Define a radius scale: `--radius-sm: 8px`, `--radius-md: 12px`, `--radius-lg: 16px`, `--radius-xl: 20px`, `--radius-full: 999px`.

**D. Font weight inconsistency**
Weights used: 400, 500, 600, 650, 700, 750, 800, 850, 900. Many are not loaded (Noto Sans SC only loads 400, 500, 600, 700).
- **Fix**: Restrict to loaded weights: 400, 500, 600, 700. Use `font-variation-settings` if variable fonts are desired.

### 6.2 Unpolished Areas

**A. Spacing tokens unused**
The `--space-*` variables are completely unused. Every component hardcodes its own padding/margin/gap values.
- **Fix**: Replace hardcoded spacing with token values.

**B. No consistent type scale**
Font sizes are arbitrary. A modular scale (e.g., 12, 14, 16, 20, 24, 32) would create more rhythm.

**C. Handoff UI feels like a different app**
The `.handoff-*` classes (lines 4841-5223) use a different color palette (`#f8fafc`, `#e2e8f0`, `#1e293b`) that doesn't match the Variant B system. This section looks like it was copied from a Tailwind/Shadcn project and not fully integrated.

**D. Mobile experience is incomplete**
While media queries exist, the mission control timeline (`grid-template-columns: repeat(4, 1fr)`) becomes unreadable on small screens. The canvas thumbnail is hidden on mobile (`display: none`), which removes a key navigation aid.

### 6.3 Accessibility Concerns

| Issue | Severity | Location |
|-------|----------|----------|
| No global dark mode | Medium | Entire app |
| Color-only status indicators | Medium | Canvas node dots, credibility badges |
| `font-weight: 650/750/850` may not render as intended | Low | Buttons, labels |
| Some text has very low contrast (`opacity: 0.46` for disabled) | Low | Disabled buttons |
| No `focus-visible` styles on many interactive elements | Medium | Cards, pills |
| Canvas nodes rely on color alone for status | Medium | `.status-risk`, `.status-supported`, etc. |
| No `aria-label` on canvas nodes except handoff nodes | Medium | Canvas visualization |

**Positive accessibility notes:**
- `aria-live="polite"` on agent output lists
- `aria-label` on progress bars
- `role="button"` and `tabIndex={0}` on demo cards
- `prefers-reduced-motion` media query present

### 6.4 Technical Debt

**A. 5496-line single file**
`styles.css` is a monolith. It contains:
- Root variables
- Workspace layout
- Canvas/node styles
- Dashboard styles
- Legacy diagnosis banner styles
- Floating input bar
- Reasoning island
- React Flow overrides
- Sidebar panels
- Report modal
- Agent panel
- Settings panel
- Sherlock search
- Mission control
- Result workspace
- Handoff UI
- Variant B overrides

**B. Commented "legacy" code**
Lines 1715-1843 contain "Legacy Diagnosis Banner styles (kept for reference)" — these should be removed or moved to an archive.

**C. Duplicate floating input bar styles**
Lines 2044-2159 and 2535-2640 define `.floating-input-bar` twice with slight differences.

---

## 7. Current "Brand" Character

### 7.1 Personality Assessment

The design conveys:

**Professional & Serious**
- Serif headings (Noto Serif SC) evoke newspapers, academic papers, and editorial authority
- Desaturated color palette avoids the "tech startup" vibrancy
- Flat design without playful shadows suggests maturity

**Trustworthy & Transparent**
- The "truth stamp" visual metaphor directly communicates verification
- Color-coded credibility scale (green = high, red = critical) is intuitive
- Step-by-step timeline shows the process, not just the conclusion
- Source citations with clickable links demonstrate traceability

**Modern & Technical**
- Grid backgrounds on canvas evoke engineering diagrams / node-based tools
- JetBrains Mono for metadata suggests precision and technical rigor
- React Flow canvas with animated edges feels like a professional tool
- Glassmorphism on topbars (blur + transparency) is contemporary

**Journalistic / Investigative**
- "Truth Hunter" positioning is reinforced by the detective-like visual language
- Agent names (Rumor Detector, Fact Checker, Source Validator) read like newsroom roles
- The report format mimics investigative journalism output

### 7.2 Target Audience Fit

The design appears targeted at:
- **General internet users** who want to verify claims (accessible dashboard)
- **Researchers / journalists** who need structured analysis (detailed report panel)
- **Technically curious users** who want to see the reasoning process (canvas visualization)

The three-phase UI (Dashboard -> Mission Control -> Result) successfully serves all three audiences with appropriate depth at each stage.

### 7.3 Comparison to Similar Tools

| Tool | Visual Style | How 真探 Compares |
|------|-------------|-------------------|
| Flowith | Node-based canvas, minimal white | Very similar canvas approach; 真探 adds more editorial typography |
| Perplexity | Clean search + citations | 真探 has more visual process transparency (timeline, canvas) |
| GPT-4 / ChatGPT | Minimal chat interface | 真探 is more structured and less conversational |
| Fact-checking sites (Snopes, etc.) | Article-based | 真探 is more interactive and process-oriented |

---

## 8. Recommendations Summary

### High Priority
1. **Consolidate color system** — replace hardcoded hex values with semantic variables
2. **Use spacing tokens** — replace hardcoded padding/margin/gap with `--space-*` variables
3. **Fix shadow inconsistency** — either commit to flat or define shadow tokens
4. **Split CSS into modules** — separate by component/phase (dashboard.css, mission.css, result.css, canvas.css)

### Medium Priority
5. **Standardize type scale** — define a modular scale (e.g., 12/14/16/20/24/32)
6. **Unify border radius** — create a radius scale
7. **Integrate Handoff UI colors** — map to Variant B palette
8. **Add focus-visible styles** — improve keyboard navigation

### Low Priority
9. **Global dark mode** — implement `prefers-color-scheme` and toggle
10. **Remove legacy CSS** — delete commented/duplicate styles
11. **Font weight cleanup** — restrict to loaded weights (400, 500, 600, 700)
12. **Accessibility audit** — add ARIA labels to canvas, ensure color+icon for all status indicators

---

*End of Design Audit*

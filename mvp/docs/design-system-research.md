# Design System Research Report

## Esther Design System (Primary) + Aether Design System (Reference)

**Research Date:** 2026-05-30
**Purpose:** Inform design decisions for 真探 Agent (Chinese-language AI fact-checking app)

---

## Executive Summary

| Dimension | Esther Design System | Aether Design System |
|-----------|---------------------|---------------------|
| **Philosophy** | Constraint-driven AI governance — "limiting AI freedom = guaranteeing quality" | Pragmatic team foundation — "building block for our projects" |
| **Target** | Personal brand / AI-generated pages | Team projects / Next.js applications |
| **Tech Stack** | Pure HTML/CSS, no framework | Next.js + Tailwind + TypeScript |
| **Color Approach** | Fixed 3-color IP palette (60/30/10 rule) | Extensible CSS variable scales (50-900) |
| **Typography** | 5-font stack (serif headings + sans body) | 2-font system (Inter + AvertaStd) |
| **Chinese Support** | First-class (Noto Serif SC, Noto Sans SC) | None (English-first) |
| **Unique Trait** | Hand-drawn crayon warmth, anti-AI aesthetic | Clean, professional, moon.io inspired |

**Key Insight:** Esther's system is uniquely valuable for 真探 Agent because it was explicitly built for AI-to-AI design handoff, has first-class Chinese typography support, and its "anti-generic" philosophy directly combats the "AI-generated look" that undermines trust in a fact-checking product.

---

## Repository 1: Esther Design System (Primary)

**URL:** https://github.com/esthersjw/esther-design-system
**Author:** esthersjw
**License:** Not specified
**Stars:** Not public (personal system)

### 1. Color System

#### Primary IP Colors (Fixed Ratio)
| Token | Hex | Usage | Ratio |
|-------|-----|-------|-------|
| `--color-blue` | `#2B7FD8` | Primary actions, headings, links, emphasis | 60% |
| `--color-yellow` / `--color-gold` | `#F4D758` | Accents, highlights, badges, decorations | 30% |
| `--color-red` | `#E84A5F` | CTAs, warnings, underlines, labels | 10% |

**Rule:** Red is always accent, never primary. The 60/30/10 ratio is enforced.

#### Extended Palette
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg-primary` | `#fefcf6` | Main background (warm cream) |
| `--color-bg-secondary` | `#faf6eb` | Darker cream background |
| `--color-bg-deep` | `#f0e9dc` | Deepest cream variant |
| `--color-text-primary` | `#1A1A2E` | Primary text ("ink" — never pure black) |
| `--color-text-secondary` | `#4A4A5A` | Secondary/muted text |
| `--color-text-muted` | `#888888` | Tertiary text |
| `--color-dark-bg-1` | `#151821` | Dark scene base (fullscreen HTML only) |
| `--color-dark-bg-2` | `#0d1117` | Cool blue dark base |
| `--color-terminal-green` | `#4ade80` | Terminal style scenes |

#### Functional Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-speech-cola` | `#2B7FD8` | Blue speech bubble (white text) |
| `--color-speech-buer` | `#F4D758` | Yellow speech bubble (black text) |
| `--color-selection-bg` | `#F4D758` | Text selection highlight |
| `--color-selection-text` | `#1a1a1a` | Selection text color |

#### Dark Mode
- **Limited dark mode:** Only for fullscreen HTML scenes (`#151821`, `#0d1117`)
- **No full dark mode toggle** — warm cream backgrounds are brand-defining
- Dark panels used sparingly ("一页最多用1~2个深色面板，用于制造节奏对比")

#### Prohibited Colors
- Blue-purple gradients
- Cyan, neon colors
- Pure black (`#000000`) or pure white (`#FFFFFF`)
- AI cold gray-blue
- Glassmorphism effects

---

### 2. Typography

#### Font Stack (5 Fonts)
| Token | Font | Role | Weight |
|-------|------|------|--------|
| `--font-en-display` | `Fraunces` (italic) | English decorative / headings | 900 |
| `--font-en-handwritten` | `Caveat` | English handwritten, annotations | 700 |
| `--font-en-mono` | `Fira Code` | Technical / terminal scenes | 400 |
| `--font-zh-heading` | `Huiwen Mincho` (汇文明朝体) | Chinese headings | 900 |
| `--font-zh-heading-fallback` | `Noto Serif SC` | Chinese serif fallback | 900 |
| `--font-zh-body` | `Noto Sans SC` + system stack | Chinese body text | 400 |
| `--font-system` | `-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif` | Fastest local rendering | — |

**Core Principle:** "标题用衬线，正文用无衬线" — serif for headings, sans-serif for body

#### Type Scale (Fluid via clamp())
| Token | Value | Usage |
|-------|-------|-------|
| `--text-hero` | `clamp(2.8rem, 7vw, 5.5rem)` | Hero headlines |
| `--text-section` | `clamp(1.6rem, 4vw, 2.6rem)` | Section headings |
| `--text-card` | `1.15rem` to `1.4rem` | Card titles |
| `--text-body` | `16px` | Body text |
| `--text-small` | `0.78rem` to `0.85rem` | Auxiliary text |
| `--text-display-number` | `clamp(3rem, 8vw, 7rem)` | Large decorative numbers |
| `--text-mono` | `0.7rem` to `0.88rem` | Code, labels |
| `--text-handwritten` | `1rem` to `1.6rem` | Labels, notes |

#### Line Heights
- Body: `1.7` to `2.2` (generous for readability)
- Headings: tighter, approximately `1.1` to `1.3`

#### Letter Spacing
- Not explicitly defined; relies on font defaults
- Display numbers: `opacity: 0.12` to `0.2` (subtle, not spacing)

#### Selection Styling
```css
::selection {
  background: #F4D758;
  color: #1a1a1a;
}
```

---

### 3. Spacing System

#### Fluid Spacing Tokens
| Token | Value | Usage |
|-------|-------|-------|
| `--space-section` | `clamp(80px, 12vh, 160px)` | Between sections |
| `--space-content` | `clamp(40px, 6vw, 100px)` | Between content blocks |
| `--space-card-padding` | `clamp(28px, 3vw, 44px)` | Card internal padding |
| `--space-gap` | `clamp(24px, 3vw, 48px)` | Element gaps |

#### Layout Constraints
| Token | Value |
|-------|-------|
| `--max-width-content` | `1300px` |
| `--layout-center` | `margin: 0 auto` |
| Standard padding | `0 2rem` |

#### Component Spacing
| Element | Value |
|---------|-------|
| Card padding | `20px` to `48px` |
| Card border radius | `12px` to `20px` |
| Card gap | `16px` to `28px` |
| Component gap | `8px` to `16px` |
| Section padding | `clamp(40px, 6vh, 120px)` |

#### Spacing Rules
- "不要做成对称50/50，不对称比例才有张力" — asymmetric ratios create tension
- "步骤不超过5个，超过则拆分成多组"
- "不要出现落单的孤儿卡片，保持3/6/9的数量"

---

### 4. Component Patterns

#### Cards (5 Variants)
| Variant | Structure | Key Visual |
|---------|-----------|------------|
| **Magazine** | Padding `32px 24px 20px` | Min-height title `120px`, serif `2rem` |
| **Number** | Relative, `overflow: hidden` | Absolute number `5.5rem` at `top: -10px` |
| **Tag** | White bg, radius `12px` | Pill badge `3px 12px`, radius `20px` |
| **Icon** | Flex row, `min-height: 130px` | Icon area `33%`, emoji `2.8rem` |
| **Quote** | 5 sub-variants | See below |

**Quote Card Sub-variants:**
| ID | Name | Key Features |
|----|------|--------------|
| 1E-A | Minimal Line | `2px` left border, `opacity: 0.15` |
| 1E-B | Editorial | `::before` giant quote mark `5rem`, yellow, shadow `0 8px 40px` |
| 1E-C | Handwritten | `2px dashed` border, `Caveat` badge absolute `top: -12px` |
| 1E-D | Highlighter | `linear-gradient` underline `rgba(244,215,88,0.5)` |
| 1E-E | Terminal | Dark bg `#1e1e2e`, macOS dots, green prompt |

#### Buttons / CTAs
| Property | Value |
|----------|-------|
| Padding | `14px 32px` |
| Border radius | `12px` |
| Background | `--color-blue` (`#2B7FD8`) |
| Hover | `translateY(-2px)` + shadow increase |
| Text | White, sans-serif |

#### Filter Tags
| Property | Value |
|----------|-------|
| Padding | `6px 14px` |
| Border radius | `20px` (pill) |
| Font size | `12px` |
| Active state | White text on blue background |
| Transition | `0.2s` |

#### Navigation
| Property | Value |
|----------|-------|
| Position | Fixed, top 0 |
| Z-index | 100 |
| Background | `rgba(254,252,246,.85)` |
| Backdrop filter | `blur(12px)` |
| Border-bottom | `1px solid rgba(26,26,26,.06)` |
| Height | ~64px (padding `1rem 2rem`) |
| Links | `0.85rem`, yellow underline on hover (scaleX transform) |
| Scrolled state | `box-shadow: 0 2px 20px` |

#### Chat Bubbles
| Role | Background | Text Color | Radius | Tail |
|------|-----------|------------|--------|------|
| User | `--yellow` (`#F4D758`) | `--ink` (`#1A1A2E`) | `18px`, `br-radius: 4px` | Bottom-right |
| AI | `--blue` (`#2B7FD8`) | `#fefcf6` | `18px`, `bl-radius: 4px` | Bottom-left |
| Max-width | `85%` | | | |
| Gap | `16px` | | | |

#### Code Panels (4 Variants)
| Variant | Background | Border | Font | Special |
|---------|-----------|--------|------|---------|
| **macOS** | `#1a1b26` | Radius `12px`, shadow `0 12px 48px` | Fira Code `0.82rem` | Titlebar `#2d2d3a`, 3 dots |
| **Notebook** | `#fffef8` | `1px solid #e8e4d9`, shadow `2px 3px 0` | Fira Code `0.8rem` | Red margin line, ruled paper bg |
| **Typewriter** | `#f5f0e8` | `2px solid #d4c9b5` | Fira Code `0.82rem` | Blinking cursor, label |
| **Clean** | White | Radius `16px`, shadow `0 1px 3px` | Fira Code `0.82rem` | Corner tag, highlight line |

#### Section Header Pattern
```
Number: Fraunces italic, opacity 0.3, blue
Title: Noto Serif SC 900, clamp(1.4rem, 3vw, 2.2rem)
Stack: number above, title below with 0.25rem gap
```

#### Tip Header Pattern
```
Number: Fraunces 900, clamp(3rem, 8vw, 7rem), opacity 0.15
Title: Noto Serif SC 900, negative margin-top -0.5rem
Overlap: Number behind, title in front
```

#### 3-Column Grids (5 Variants)
| Variant | Structure | Visual Hook |
|---------|-----------|-------------|
| **Giant Number** | White card, shadow `0 4px 24px` | `6rem` number, brand color rotation |
| **Magazine** | No bg, border-bottom `1px` | Roman numerals, Fraunces title |
| **Dashed** | `2px dashed` border | Caveat label absolute, color rotation |
| **Gradient** | Gradient fill bg | Emoji `2rem`, no border |
| **Typography** | No card at all | `32px` colored divider bar |

#### Do/Don't Patterns (4 Variants)
| Variant | Layout | Visual System |
|---------|--------|---------------|
| **Cards** | 2-column grid | Bottom border color (red/blue), check/x icons |
| **Handwritten** | Dashed border container | Caveat titles, strikethrough for "don't" |
| **Table** | 3-column grid | Dark header, emoji status columns |
| **Stamp** | 2-column, thick border | Centered uppercase label, absolute top |

#### Interactive Components
| Component | Trigger | Animation | Duration |
|-----------|---------|-----------|----------|
| Skill card | Hover | Gradient top bar + `translateY(-4px)` | `0.3s` |
| Book card | Hover | `translateY(-4px)`, shadow increase | `0.2s` |
| Filter tag | Click | BG switch to `--blue`, white text | `0.2s` |
| Modal | Click | `display: block`, backdrop blur | Instant |
| Accordion | Click | `display` toggle + fade | `0.3s` |
| Tab switcher | Click | Underline slide + panel fade | `0.2–0.3s` |
| Carousel | Arrow/dot | `translateX` slide | `0.4s` |
| Stack cards | Click | `translateX(-120%) rotate(-5deg)`, opacity 0 | `0.3s` |
| Flip card | Click | `rotateY(180deg)` | `0.6s` |
| Hover reveal | Hover | Overlay opacity 0→1 | `0.4s` |
| Dark reveal | Button click | Text opacity toggle | `0.5s` |

#### Scroll Reveal Animation
| Property | Value |
|----------|-------|
| Initial | `opacity: 0`, `translateY(32px)` |
| Duration | `0.7s` |
| Easing | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Delays | `0.1–0.5s` increments |
| Trigger | `IntersectionObserver`, `threshold: 0.12` |
| Reduced motion | Disable entirely |

---

### 5. Design Principles / Philosophy

#### Core Philosophy
> "限制AI的自由度 = 保证输出质量"
> — Constraining AI's creative freedom ensures consistent output quality.

#### Brand Essence
> "可爱但有品质 · 手绘蜡笔感 · 有温度 · 不像AI · 一看就是'不二的'"
> — Cute yet premium, hand-drawn crayon texture, warm, distinctly non-AI.

#### What Makes It Unique
1. **AI Governance System:** Not just a design system — it's an operationalized taste manual. Every rule exists to prevent AI from making "safe" generic choices.
2. **Anti-AI Aesthetic:** Explicitly designed to NOT look like AI-generated content. The "Twitter test" ("截图发Twitter会不会被说'又是AI做的'") is a core quality gate.
3. **Chinese-First Typography:** 汇文明朝体 + Noto Serif SC for headings, Noto Sans SC for body — designed for Chinese content from the ground up.
4. **IP-Driven Color System:** Colors tied to a character (blue hair, yellow dress, red bow) — makes the palette memorable and meaningful.
5. **Constraint as Feature:** The prohibitions list is as important as the specifications. What you CAN'T do defines the system as much as what you can.

#### Target Audience
- Primary: AI assistants generating HTML pages for the creator's personal IP
- Secondary: Other creators wanting similar control over AI output
- Use cases: Tutorial pages, landing/event pages, app/functionality pages, Xiaohongshu content

#### Key Visual Characteristics
- Warm cream backgrounds (never cold white)
- Serif + sans-serif mixing ("标题用衬线，正文用无衬线")
- Hand-drawn crayon feel (Caveat font, dashed borders)
- Asymmetric layouts ("不对称比例才有张力")
- Yellow decorative border (fixed at 40px)
- Large decorative numbers with low opacity
- No centered sections after hero
- No default HTML element styling

---

### 6. CSS / Token Architecture

#### Token Organization
Pure CSS custom properties in `:root` — no build step, no framework dependency.

```css
:root {
  /* Primary IP colors */
  --color-blue: #2B7FD8;
  --color-yellow: #F4D758;
  --color-red: #E84A5F;

  /* Backgrounds */
  --color-bg: #fefcf6;
  --color-bg-deep: #faf6eb;
  --color-dark-1: #151821;
  --color-dark-2: #0d1117;

  /* Text */
  --color-text: #1A1A2E;
  --color-text-alt: #1a1a1a;
  --color-text-secondary: #4A4A5A;

  /* Typography */
  --font-heading: 'Huiwen Mincho', 'Noto Serif SC', serif;
  --font-body: 'Noto Sans SC', -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif;
  --font-en: 'Fraunces', serif;
  --font-handwritten: 'Caveat', cursive;
  --font-mono: 'Fira Code', monospace;

  /* Fluid sizes */
  --text-hero: clamp(2.8rem, 7vw, 5.5rem);
  --text-section: clamp(1.6rem, 4vw, 2.6rem);
  --text-display: clamp(3rem, 8vw, 7rem);

  /* Spacing */
  --space-section: clamp(80px, 12vh, 160px);
  --space-content: clamp(40px, 6vw, 100px);
  --space-card: clamp(28px, 3vw, 44px);
  --space-gap: clamp(24px, 3vw, 48px);

  /* Layout */
  --max-width: 1300px;
  --border-yellow: 40px;
}
```

#### No Tailwind Integration
- Pure HTML/CSS templates
- No build step required
- CSS custom properties for all tokens
- `clamp()` for fluid responsive sizing

#### File Architecture
```
esther-design-system/
├── SKILL.md              # 7-step AI workflow
├── brand-dna.md          # Brand genes: colors/fonts/vibe/taboos
├── README.md
├── assets/               # Template skeletons
│   ├── template-tutorial.html
│   ├── template-landing.html
│   ├── template-app.html
│   ├── template-cards.html
│   └── avatar.jpg
└── references/           # Rules & parts library
    ├── layouts.md        # 15 layout patterns with full code
    ├── components.md     # Component library (2,988 lines)
    ├── checklist.md      # Quality checks (P0/P1/P2)
    └── scene-*.md        # Per-scenario specifications
```

#### Quality Gates (P0/P1/P2)
| Tier | Criteria |
|------|----------|
| **P0 (Mandatory)** | Brand tri-color ratio, no forbidden elements, warm backgrounds, approved fonts, serif+sans-serif pairing, responsive (900px breakpoint), unique layout per section, `clamp()` fluid sizing, no default HTML styles |
| **P1 (Expected)** | Visual surprise section, extreme type contrast, scroll reveal, decorative numbers, brand color bar, `::selection` yellow highlight |
| **P2 (Bonus)** | Image overflow, full-width dark panel, restrained decorative elements, `prefers-reduced-motion` |

---

## Repository 2: Aether Design System (Reference)

**URL:** https://github.com/theodorusclarence/aether-design-system
**Author:** Theodorus Clarence, Rizqi Tsani, Wina Tungmiharja
**License:** MIT
**Stars:** 137
**Forks:** 9
**Live Demo:** https://aether.thcl.dev

### 1. Color System

#### Primary Scale (CSS Variables — RGB Channels)
| Token | Format | Notes |
|-------|--------|-------|
| `primary-50` to `primary-900` | `rgb(var(--tw-color-primary-xxx) / <alpha-value>)` | Full 9-step scale |
| `primary-500` | `rgb(78 70 180)` | Main brand color (indigo-purple) |
| `primary-700` | `rgb(32 24 138)` | Dark variant |
| `primary-900` | `rgb(12 7 80)` | Deepest variant |

#### Secondary Scale (Hex Values)
| Token | Hex | Usage |
|-------|-----|-------|
| `secondary-50` | `#EFF9F8` | Lightest background |
| `secondary-100` | `#E8F4F3` | Light background |
| `secondary-200` | `#E0F3F1` | Subtle fill |
| `secondary-300` | `#D0EDEB` | Border/divider |
| `secondary-400` | `#A2DBD7` | Muted accent |
| `secondary-500` | `#40A69F` | Main secondary (teal) |
| `secondary-600` | `#3B9993` | Hover state |
| `secondary-700` | `#2F7A75` | Active state |
| `secondary-800` | `#235C58` | Dark variant |
| `secondary-900` | `#173D3A` | Deepest variant |

#### Typography Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `typo-DEFAULT` | `#1F1F1F` | Primary text |
| `typo-secondary` | `#707070` | Secondary text |
| `typo-tertiary` | `#999CA0` | Tertiary/muted text |
| `typo-icons` | `#999CA0` | Icon color |
| `typo-divider` | `#EBEBEB` | Divider lines |
| `typo-outline` | `#D9D9D9` | Borders |
| `dark` | `#222222` | Dark backgrounds |
| `light` | `#F5F5F5` | Light backgrounds |

#### Semantic Colors (Standard Tailwind)
- `red-50` to `red-900` — Danger/error states
- `green-50` to `green-900` — Success states
- `yellow-50` to `yellow-900` — Warning states
- `amber-500/600/700` — Warning button variant
- `orange-100/700` — Tag variant

#### Dark Mode
- Not explicitly implemented in the design system
- `dark` color token (`#222222`) available but no full dark mode architecture

---

### 2. Typography

#### Font Families
| Token | Font | Weights | Role |
|-------|------|---------|------|
| `font-primary` | `Inter` | 100–900 (variable) | Default body text |
| `font-averta` | `AvertaStd` | 400, 600, 700 + italic | Headings, display |

#### Type Scale (19 Variants)
| Variant | Size | Weight | Font | Usage |
|---------|------|--------|------|-------|
| `j1` | `36px` (text-4xl) | 700 | averta | Display 1 |
| `j2` | `30px` (text-3xl) | 700 | averta | Display 2 |
| `h1` | `24px` (text-2xl) | 600 | averta | Heading 1 |
| `h2` | `20px` (text-xl) | 600 | averta | Heading 2 |
| `h3` | `18px` (text-lg) | 600 | averta | Heading 3 |
| `h4` | `16px` (text-base) | 700 | averta | Heading 4 |
| `h5` | `16px` (text-base) | 600 | averta | Heading 5 |
| `h6` | `14px` (text-sm) | 600 | averta | Heading 6 |
| `s1` | `18px` | 500 | default | Supporting 1 |
| `s2` | `16px` | 500 | default | Supporting 2 |
| `s3` | `14px` | 500 | default | Supporting 3 |
| `s4` | `12px` | 500 | default | Supporting 4 |
| `b1` | `18px` (text-lg) | 400 | default | Body 1 |
| `b2` | `16px` (text-base) | 400 | default | Body 2 (default) |
| `b3` | `14px` (text-sm) | 400 | default | Body 3 |
| `c1` | `12px` (text-xs) | 400 | default | Caption 1 |
| `c2` | `11px` | 400 | default | Caption 2 |

#### Typography Colors
| Token | Value |
|-------|-------|
| `primary` | `#1F1F1F` (black) |
| `secondary` | `#707070` (gray-700) |
| `tertiary` | `#999CA0` (gray-500) |
| `danger` | `#EF4444` (red-500) |
| `white` | `#FFFFFF` |

#### Line Heights & Letter Spacing
- Not explicitly defined; uses Tailwind defaults
- `Balancer` component used for text wrapping optimization

---

### 3. Spacing System

#### Layout Spacing
| Token | Value | Usage |
|-------|-------|-------|
| `.layout` | `max-width: 68.75rem` (1100px), width: 11/12 | Main container |
| `.min-h-main` | `calc(100vh - 56px)` | Minimum main content height |

#### Component Spacing
- Uses Tailwind default spacing scale (0.5 = 2px, 1 = 4px, etc.)
- No custom spacing extensions in tailwind.config.js

#### Spacing Rules
- Container centered with `mx-auto`
- Content width: 11/12 of viewport (responsive)
- No explicit padding system defined

---

### 4. Component Patterns

#### Buttons (6 Variants, 3 Sizes)
| Variant | Background | Text | Border | Hover | Active | Focus Ring |
|---------|-----------|------|--------|-------|--------|------------|
| `primary` | `bg-primary-500` | White | `primary-600` | `primary-600` | `primary-700` | `primary-400` |
| `secondary` | `bg-secondary-500` | White | `secondary-600` | `secondary-600` | `secondary-700` | `secondary-400` |
| `danger` | `bg-red-500` | White | `red-600` | `red-600` | `red-700` | `red-400` |
| `warning` | `bg-amber-500` | White | `amber-500` | `amber-600` | `amber-700` | `amber-400` |
| `outline` | Transparent | `text-typo` | `gray-300` | `bg-light` | `bg-typo-divider` | `primary-400` |
| `ghost` | Transparent | `text-primary-500` | None | `bg-primary-50` | `bg-primary-100` | `primary-400` |

**Sizes:**
| Size | Height | Padding | Text Size |
|------|--------|---------|-----------|
| `sm` | `min-h-[1.75rem]` | `px-2` | `text-xs md:text-sm` |
| `base` | `min-h-[2.25rem]` | `px-3` | `text-sm md:text-base` |
| `lg` | `min-h-[2.75rem]` | `px-3.5` | `text-base` |

**Shared Styles:**
- Base: `inline-flex items-center justify-center rounded-lg font-medium shadow-sm transition-colors duration-75`
- Focus: `focus:outline-none focus-visible:ring`
- Disabled: `disabled:cursor-not-allowed` (also applies when `isLoading`)
- Loading: spinner centered, text transparent

#### Tags / Badges (7 Colors, 2 Sizes)
| Color | Background | Text |
|-------|-----------|------|
| DEFAULT | `bg-light` | `text-typo-secondary` |
| primary | `bg-primary-100` | `text-primary-700` |
| secondary | `bg-secondary-100` | `text-secondary-700` |
| danger | `bg-red-100` | `text-red-700` |
| orange | `bg-orange-100` | `text-orange-700` |
| warning | `bg-yellow-100` | `text-yellow-700` |
| success | `bg-green-100` | `text-green-700` |

**Structure:** `inline-flex items-center gap-1 rounded-full px-3 font-medium`
**Sizes:** `sm` (`py-0.5 text-xs`), `base` (`py-1 text-sm`)

#### Alerts (5 Types)
| Type | Background | Text |
|------|-----------|------|
| primary | `bg-primary-50` | `text-secondary` |
| secondary | `bg-secondary-50` | `text-secondary` |
| warning | `bg-yellow-50` | `text-secondary` |
| danger | `bg-red-50` | `text-secondary` |
| success | `bg-green-50` | `text-secondary` |

**Structure:** `w-full rounded-xl p-3 text-sm text-center`

#### Input Fields
| State | Border | Background | Focus Ring |
|-------|--------|------------|------------|
| Default | `border-gray-300` | White | `focus:border-primary-500 focus:ring-primary-500` |
| ReadOnly/Disabled | `border-gray-300` | `bg-gray-100` | `focus:border-gray-300 focus:ring-0` |
| Error | `border-red-500` | White | `focus:border-red-500 focus:ring-red-500` |

**Structure:** `flex w-full rounded-lg shadow-sm min-h-[2.25rem] py-0 md:min-h-[2.5rem]`
**Icon Spacing:** Left icon `pl-9`, Right node `pr-10`
**Helper Text:** `Typography variant='c1' color='secondary' className='mt-1'`
**Error Message:** `Typography variant='c1' color='danger' className='mt-1'`

#### Modal / Dialog
| Element | Styling |
|---------|---------|
| Backdrop | `bg-black bg-opacity-50`, fade transition |
| Panel | White, `rounded-2xl`, `shadow-xl` |
| Width | `sm:w-11/12 sm:max-w-xl` (overridable) |
| Padding | `px-4 pt-4 pb-20` mobile, `sm:p-0` desktop |
| Section padding | `p-4 sm:p-6` |
| Enter animation | `opacity-0 translate-y-4` → `opacity-100 translate-y-0 sm:scale-100` |
| Leave animation | Reverse of enter |
| Mobile behavior | Slides up; desktop scales |

#### Table
| Element | Styling |
|---------|---------|
| Container | `flex flex-col`, scrollable with `-mx-4` |
| Surface | `overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg` |
| Table | `min-w-full divide-y divide-gray-300` |
| Dividers | `divide-gray-300` |
| Interactive | Sorting via `sorting` state, filtering via `globalFilter` |

#### Cards
- Not a dedicated component in the source; cards styled via Tailwind utilities
- Common pattern: `bg-white rounded-xl shadow-sm` or similar

#### Navigation
- Not a dedicated component; patterns inferred from layout files

---

### 5. Design Principles / Philosophy

#### Core Philosophy
> "Aether serves as the building block for our projects"
> — A pragmatic foundation built before projects start.

#### Design Inspiration
- "Mostly inspired by moon.io, adjusted to our needs"
- Practical, needs-driven customization rather than generic solutions

#### What Makes It Unique
1. **Team-Oriented:** Built for collaborative project development, not personal branding
2. **TypeScript-First:** 93.7% TypeScript — strongly typed component APIs
3. **Integration-Ready:** Pre-configured with React Hook Form, React Query, Toast, Zustand
4. **moon.io Aesthetic:** Clean, modern, slightly premium feel
5. **Extensible Scale System:** 9-step color scales (50-900) allow fine-grained theming

#### Target Audience
- Development teams building Next.js applications
- Projects needing a consistent UI foundation
- Teams valuing type safety and modern React patterns

#### Key Visual Characteristics
- Clean, professional appearance
- Indigo-purple primary + teal secondary
- Inter for body, AvertaStd for headings
- Rounded corners (`rounded-lg`, `rounded-xl`, `rounded-2xl`)
- Subtle shadows (`shadow-sm`, `shadow`, `shadow-xl`)
- No strong personality — designed to be neutral and adaptable

---

### 6. CSS / Tailwind / Token Architecture

#### Tailwind Configuration
```javascript
// tailwind.config.js key excerpts
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'rgb(var(--tw-color-primary-50) / <alpha-value>)',
          // ... 100-900
        },
        secondary: {
          50: '#EFF9F8',
          100: '#E8F4F3',
          // ... 200-900 (hex values)
        },
        typo: {
          DEFAULT: '#1F1F1F',
          secondary: '#707070',
          tertiary: '#999CA0',
          icons: '#999CA0',
          divider: '#EBEBEB',
          outline: '#D9D9D9',
        },
        dark: '#222222',
        light: '#F5F5F5',
      },
      fontFamily: {
        primary: ['Inter', ...fontFamily.sans],
        averta: ['AvertaStd', ...fontFamily.sans],
      },
      keyframes: {
        flicker: { /* opacity alternates 0.99/0.4 */ },
        shimmer: { /* backgroundPosition animation */ },
      },
      animation: {
        flicker: 'flicker 3s linear infinite',
        shimmer: 'shimmer 1.3s linear infinite',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
    require('tailwindcss-animate'),
  ],
};
```

#### CSS Variables for Primary Colors
Primary colors use CSS custom properties (RGB channels) for dynamic opacity support:
```css
:root {
  --tw-color-primary-50: 239 238 251;
  --tw-color-primary-100: 221 219 246;
  /* ... */
  --tw-color-primary-500: 78 70 180;
  /* ... */
  --tw-color-primary-900: 12 7 80;
}
```

#### Token Architecture
- **Primary colors:** CSS variables (RGB) → Tailwind `rgb()` function → dynamic opacity
- **Secondary colors:** Static hex values in Tailwind config
- **Typography colors:** Semantic tokens (`typo-DEFAULT`, `typo-secondary`, etc.)
- **No custom spacing, border radius, or shadow extensions**

#### File Architecture
```
aether-design-system/
├── src/
│   ├── components/
│   │   ├── alert/
│   │   ├── buttons/
│   │   ├── cards/
│   │   ├── dialog/
│   │   ├── forms/
│   │   ├── layout/
│   │   ├── links/
│   │   ├── modal/
│   │   ├── popover/
│   │   ├── table/
│   │   ├── tag/
│   │   ├── typography/
│   │   ├── Banner.tsx
│   │   ├── Breadcrumb.tsx
│   │   ├── DismissableToast.tsx
│   │   ├── NextImage.tsx
│   │   ├── NextImageLightbox.tsx
│   │   ├── Seo.tsx
│   │   ├── Skeleton.tsx
│   │   └── Tooltip.tsx
│   ├── lib/
│   ├── pages/
│   ├── stores/
│   ├── styles/
│   │   └── globals.css
│   └── types/
├── tailwind.config.js
├── next.config.js
└── package.json
```

---

## Design Principles — Key Takeaways

### 1. Constraint Drives Quality
Esther's system proves that limiting options (3 colors, 5 fonts, 15 layouts) produces more distinctive output than unlimited freedom. For 真探 Agent, this means:
- Define a tight color palette and enforce it
- Limit layout options to prevent generic grids
- Create "forbidden" lists for AI-generated content

### 2. Typography is Identity
Both systems treat typography as foundational:
- Esther: 5-font stack with deliberate serif/sans-serif mixing
- Aether: Dual-font system (Inter + AvertaStd) with 19 variants

For Chinese content (真探 Agent), Esther's approach is directly applicable:
- 衬线 for headings (Noto Serif SC)
- 无衬线 for body (Noto Sans SC)
- This creates visual hierarchy without relying solely on size/weight

### 3. Warmth vs. Neutrality
| | Esther | Aether |
|--|--------|--------|
| Background | Warm cream (`#fefcf6`) | Neutral light (`#F5F5F5`) |
| Personality | Strong, opinionated | Neutral, adaptable |
| Use case | Brand expression | Team productivity |

For a fact-checking app, **Esther's warmth is an advantage**: it combats the cold, clinical feel of most AI/tech products, building trust through humaneness.

### 4. Fluid Sizing with clamp()
Esther's extensive use of `clamp()` for responsive design:
```css
--text-hero: clamp(2.8rem, 7vw, 5.5rem);
--space-section: clamp(80px, 12vh, 160px);
```
This eliminates breakpoint-based jumps, creating smoother responsive behavior.

### 5. The "Anti-AI" Aesthetic
Esther's most valuable insight for 真探 Agent:
> "截图发Twitter上，会不会被人评论'又是AI做的'？"

A fact-checking app MUST NOT look like generic AI output. Esther's prohibitions (no glassmorphism, no neon, no Inter/Roboto, no centered sections) are directly applicable.

### 6. Component Libraries vs. HTML Defaults
Esther's rule: "禁止用HTML默认样式" — every element must be explicitly styled.
This prevents the "unstyled HTML" look that screams "AI-generated."

---

## Recommendations for 真探 Agent

### Color Palette (Adapted from Esther)
| Token | Hex | Usage | Ratio |
|-------|-----|-------|-------|
| `--zt-primary` | `#2B7FD8` | Primary actions, verified facts, links | 60% |
| `--zt-accent` | `#F4D758` | Highlights, badges, key claims | 30% |
| `--zt-alert` | `#E84A5F` | Misinformation warnings, corrections | 10% |
| `--zt-bg` | `#fefcf6` | Main background | — |
| `--zt-bg-deep` | `#faf6eb` | Card backgrounds, sections | — |
| `--zt-text` | `#1A1A2E` | Primary text | — |
| `--zt-text-muted` | `#4A4A5A` | Secondary text | — |

**Rationale:**
- Blue = trust, verification (primary)
- Yellow = attention, claims needing check (accent)
- Red = misinformation, corrections (alert)
- Warm cream = humaneness, approachability

### Typography (Adapted from Esther)
| Role | Font | Weight | Size |
|------|------|--------|------|
| Display/Hero | Noto Serif SC | 900 | `clamp(2.8rem, 7vw, 5.5rem)` |
| Section headings | Noto Serif SC | 700 | `clamp(1.6rem, 4vw, 2.6rem)` |
| Card titles | Noto Sans SC | 700 | `1.15rem` |
| Body | Noto Sans SC | 400 | `16px` |
| Labels/mono | Fira Code | 400 | `0.85rem` |

**Principle:** 标题用衬线，正文用无衬线

### Spacing (Adapted from Esther)
```css
:root {
  --zt-space-section: clamp(60px, 10vh, 120px);
  --zt-space-content: clamp(32px, 5vw, 80px);
  --zt-space-card: clamp(20px, 2.5vw, 36px);
  --zt-space-gap: clamp(16px, 2vw, 32px);
  --zt-max-width: 1200px;
}
```

### Component Patterns for 真探 Agent

#### Fact-Check Result Card
```
- Background: white or --zt-bg-deep
- Border-radius: 16px
- Padding: --zt-space-card
- Top border: 4px (green for verified, red for false, yellow for partial)
- Status badge: pill shape, brand color
- Source link: blue underline on hover
```

#### Claim Bubble (Chat Interface)
```
- User claim: --zt-accent background, --zt-text color
- AI response: --zt-primary background, white text
- Border-radius: 18px with tail
- Max-width: 85%
```

#### Verification Badge
```
- Shape: pill (border-radius: 20px)
- Verified: green bg, white text, check icon
- False: red bg, white text, x icon
- Partial: yellow bg, dark text, ~ icon
```

#### Navigation
```
- Fixed top, z-index 100
- Background: rgba(254,252,246,.9) with backdrop-filter: blur(12px)
- Height: ~64px
- Logo: serif font, blue
- Links: sans-serif, yellow underline on hover
```

### Design Principles for 真探 Agent
1. **Trust through warmth:** Warm cream backgrounds, not cold gray
2. **Authority through typography:** Serif headings convey credibility
3. **Clarity through constraint:** 3-color system, limited layout options
4. **Anti-generic:** Explicitly avoid AI-template aesthetics
5. **Chinese-first:** All typography decisions optimized for Chinese readability
6. **Accessibility:** Respect `prefers-reduced-motion`, maintain contrast ratios

### Forbidden Elements (Adapted from Esther)
- Blue-purple gradients
- Glassmorphism
- Neon colors
- Bounce animations
- Inter/Roboto as primary fonts
- All-centered layouts (except hero)
- Default HTML blockquotes/lists/tables without styling
- Pure black/white backgrounds
- Generic AI-template look

### Quality Gates for 真探 Agent
| Tier | Criteria |
|------|----------|
| **P0** | Brand color ratio, no forbidden elements, warm background, serif+sans-serif, responsive, unique layouts per section, no default HTML styles |
| **P1** | Visual surprise section, extreme type contrast, scroll reveal, decorative numbers, selection highlight |
| **P2** | Dark panel rhythm breaks, restrained decoration, reduced-motion support |

---

## Files Referenced

### Esther Design System
- `/brand-dna.md` — Color, typography, spacing tokens
- `/references/components.md` — 2,988-line component library
- `/references/layouts.md` — 15 layout patterns
- `/references/checklist.md` — P0/P1/P2 quality gates
- `/SKILL.md` — 7-step AI workflow
- `/README.md` — System overview

### Aether Design System
- `/tailwind.config.js` — Theme configuration
- `/src/styles/globals.css` — Global styles, CSS variables
- `/src/components/buttons/Button.tsx` — Button component
- `/src/components/typography/Typography.tsx` — Typography component
- `/src/components/forms/Input.tsx` — Input component
- `/src/components/modal/Modal.tsx` — Modal component
- `/src/components/tag/Tag.tsx` — Tag component
- `/src/components/alert/Alert.tsx` — Alert component
- `/src/components/table/Table.tsx` — Table component

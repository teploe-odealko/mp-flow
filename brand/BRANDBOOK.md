# MPFlow Brand Book

Version 2.0 — February 2026

---

## Concept: Поток (The Current)

Goods flow from suppliers through logistics to marketplace. Money flows back. Data flows through the ERP. The supply chain is a current — and MPFlow makes it visible and controllable.

The word "поток" is natural Russian business language: поток товаров, денежный поток, поток данных. The English "flow" in the product name carries the same meaning.

---

## Name

**mpflow** — lowercase in wordmark. In running text: **MPFlow** or **OpenMPFlow** (full OSS name).

| Context | Format |
|---------|--------|
| Wordmark / logo | mpflow |
| Running text | MPFlow |
| Full name (OSS) | OpenMPFlow |
| Code / URLs | mpflow, mp-flow |

---

## Logo

The mark is a stylized current — three flowing lines representing the movement of goods, money, and data. The lines converge to show how the ERP brings these streams together.

### Mark variants

| Variant | Usage |
|---------|-------|
| Cyan mark on dark | Primary. Dark UI, marketing, social. |
| Dark mark on light | Print, light backgrounds, documents. |
| Monochrome white | Over photos, busy backgrounds. |

### Clear space

Minimum clear space = mark height × 0.5 on all sides.

### Minimum size

Mark: 24×24px. Wordmark: 80px wide.

---

## Color Palette

### Primary

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Deep Current** | `#0C1117` | 12, 17, 23 | Page background |
| **Surface** | `#151B23` | 21, 27, 35 | Cards, sidebar, elevated surfaces |
| **Border** | `#1E2A35` | 30, 42, 53 | Subtle borders, dividers |
| **Foam** | `#E6EDF3` | 230, 237, 243 | Primary text |
| **Muted** | `#8B949E` | 139, 148, 158 | Secondary text, labels |

### Accent

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Current** | `#0EA5E9` | 14, 165, 233 | Primary accent, links, active states |
| **Current Light** | `#38BDF8` | 56, 189, 248 | Hover states |
| **Current Dark** | `#0284C7` | 2, 132, 199 | Pressed states, focus rings |
| **Current Glow** | `#0EA5E9` at 12% | — | Selection backgrounds, active glow |

### Semantic

| Name | Hex | Usage |
|------|-----|-------|
| **Inflow** | `#22C55E` | Income, received, success |
| **Outflow** | `#F97316` | Expense, shipped, warning |
| **Risk** | `#EAB308` | Attention needed |
| **Loss** | `#EF4444` | Error, loss, critical |
| **Neutral** | `#6B7280` | Archived, disabled |

### CSS Custom Properties

```css
:root {
  /* Background */
  --bg-deep: #0C1117;
  --bg-surface: #151B23;
  --bg-elevated: #1C2530;
  --bg-border: #1E2A35;

  /* Text */
  --text-primary: #E6EDF3;
  --text-secondary: #8B949E;
  --text-muted: #5C6670;

  /* Accent */
  --accent: #0EA5E9;
  --accent-light: #38BDF8;
  --accent-dark: #0284C7;
  --accent-glow: rgba(14, 165, 233, 0.12);

  /* Semantic */
  --color-inflow: #22C55E;
  --color-outflow: #F97316;
  --color-risk: #EAB308;
  --color-loss: #EF4444;
  --color-neutral: #6B7280;
}
```

---

## Typography

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| Headings | Inter | 600–700 | Tracking: -0.02em |
| Body | Inter | 400 | Line-height: 1.5 |
| Data / numbers | JetBrains Mono | 400–500 | Prices, SKUs, quantities |
| Code | JetBrains Mono | 400 | API docs, code blocks |

**Key rule:** Financial numbers (prices, margins, quantities) always render in monospace. This communicates precision and aligns columns naturally.

---

## Iconography

- Style: outlined, 1.5px stroke, rounded caps
- Size: 20×20px grid, 16/20/24px rendered sizes
- Color: `--text-secondary` default, `--accent` for active/interactive
- Source: Lucide icons (consistent with existing admin-ui)

---

## UI Guidelines

### Backgrounds
Subtle gradient from `#0C1117` (top) to `#0E1319` (bottom) — barely perceptible depth.

### Cards
Background: `--bg-surface`. Border: 1px `--bg-border`. Border-radius: 8px. No shadows.

### Active states
Cyan glow: `box-shadow: 0 0 0 1px var(--accent), 0 0 12px var(--accent-glow)`.

### Buttons
- Primary: `--accent` bg, white text, `--accent-light` on hover
- Secondary: `--bg-surface` bg, `--text-primary` text, border `--bg-border`
- Danger: `--color-loss` bg

### Status indicators
- Green dot = received, complete
- Cyan dot = in transit, processing
- Orange dot = pending, needs attention
- Red dot = error, loss

### Charts
- Income side: cyan → green spectrum
- Expense side: orange → red spectrum
- Creates natural warm/cool temperature split

---

## Application

### Login page
Deep Current background with subtle radial gradient (accent at 6% opacity, centered top). Clean card with logo mark, welcome text, single CTA button in accent color.

### Admin sidebar
Surface background (`#151B23`). Active section: left 2px border in accent, text in accent. Inactive: muted text.

### Landing page
Full-bleed Deep Current background. Hero with the flow metaphor — subtle animated lines or a static illustration of converging streams. CTA in accent color.

### API docs (Scalar)
Dark theme matching the palette. Accent for links and method badges.

### User docs (Fumadocs)
Dark theme. Sidebar navigation with accent active state. Code blocks in Surface with accent syntax highlighting.

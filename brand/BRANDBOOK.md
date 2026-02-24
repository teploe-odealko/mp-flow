# OpenMPFlow Brand Book

Version 1.0 | February 2026

---

## Table of Contents

1. [Brand Story & Mission](#1-brand-story--mission)
2. [Brand Name & Terminology](#2-brand-name--terminology)
3. [Logo System](#3-logo-system)
4. [Color Palette](#4-color-palette)
5. [Typography](#5-typography)
6. [Iconography](#6-iconography)
7. [Visual Patterns & Textures](#7-visual-patterns--textures)
8. [UI Component Guidelines](#8-ui-component-guidelines)
9. [Dark & Light Mode](#9-dark--light-mode)
10. [Voice & Tone](#10-voice--tone)
11. [Application Examples](#11-application-examples)

---

## 1. Brand Story & Mission

OpenMPFlow exists to give marketplace sellers the clarity and control they need to run a profitable business. Managing inventory, procurement, logistics, pricing, and analytics across platforms like Ozon is inherently complex -- sellers juggle spreadsheets, manual calculations, and disconnected tools, losing time and margin in the process. OpenMPFlow replaces that chaos with a single, intelligent ERP that automates the tedious work, surfaces actionable insights, and connects directly to marketplace APIs so sellers can focus on growing their business.

We believe that professional-grade business tools should not require enterprise budgets. OpenMPFlow is open-source at its core, offering both a self-hosted version for technical teams and a managed cloud service for sellers who want to get started immediately. Whether you manage 10 SKUs or 10,000, the platform adapts to your scale while maintaining the precision that unit-economics-driven businesses demand. The "flow" in our name is a promise: data flows in, decisions flow out, and your business moves forward.

---

## 2. Brand Name & Terminology

### Full Name

**OpenMPFlow** -- written as one word, with "Open", "MP", and "Flow" capitalized. Never hyphenate. Never separate into multiple words.

| Correct | Incorrect |
|---------|-----------|
| OpenMPFlow | Open MP Flow |
| OpenMPFlow | Open-MP-Flow |
| OpenMPFlow | openmpflow (in running text) |
| OpenMPFlow | OPENMPFLOW (in running text) |

In code contexts (URLs, package names, environment variables), `openmpflow` in all-lowercase is acceptable.

### Monogram

**OM** -- used in the mark, favicon, and compact UI contexts. Always uppercase. The monogram is embedded into the flow-mark icon, not displayed as standalone letters.

### Product Descriptors

Use these consistently across all surfaces:

| Context | Phrasing |
|---------|----------|
| Tagline (mark) | Marketplace ERP |
| One-liner | Open-source ERP for marketplace sellers |
| Short description | Inventory, procurement, analytics, and logistics management for Ozon sellers |
| Category | E-commerce ERP / Marketplace Management Platform |

### Naming Conventions for Features

Use plain, descriptive Russian names for feature sections visible to end users. Internal English names for code references.

| UI Section (RU) | Internal Name | Purpose |
|------------------|---------------|---------|
| Каталог | catalog | Product/SKU management |
| Закупки | procurement | Supplier orders |
| Аналитика | analytics | Unit economics, P&L, DDS reports |
| Планирование | demand | Demand planning & supply plans |
| Логистика | logistics | Supply chain matrix, Ozon supplies |
| Финансы | finance | Cash flow, transactions |
| Цены | pricing | Price calculator, commission rates |
| Настройки | settings | System and integration settings |
| MCP | mcp | AI tool server (developer-facing) |

---

## 3. Logo System

### Primary Mark (Flow Mark)

The OpenMPFlow mark is a rounded square containing three sinusoidal curves that represent data flowing through a system. The curves have varying opacity to create depth -- the center line is fully opaque (the primary data stream), while the outer lines are semi-transparent (supporting data channels).

**Construction:**
- Container: 40x40px rounded rectangle, corner radius = 25% of width (10px at 40px)
- Background: brand gradient (top-left #7C6AED to bottom-right #5046E5)
- Flow lines: white, stroke-linecap round, three curves with S-wave paths
- Center curve: 2.8px stroke, full opacity
- Outer curves: 2.4px stroke, 50% opacity

### Full Logo (Mark + Wordmark)

The full logo places the mark to the left of a two-part wordmark:
- **"OPEN"** in neutral dark (#1E1B4B light mode / #E0E7FF dark mode), weight 800
- **"MPFLOW"** in brand gradient, weight 800
- Below: "Marketplace ERP" in neutral gray (#6B7280 / #9CA3AF), weight 500

Spacing: 12px gap between mark and wordmark.

### Logo Files

| File | Usage |
|------|-------|
| `brand/logo.svg` | Light backgrounds (white, light gray) |
| `brand/logo-dark.svg` | Dark backgrounds (slate-900, hero sections) |
| `brand/favicon.svg` | Browser tabs, bookmarks, PWA icon |

### Clear Space

Minimum clear space around the logo equals the height of the mark (40px at default size). No other elements, text, or edges should intrude into this zone.

```
    +-----------+
    |  40px     |
    |  +-----+  |
    |  | MARK |  |     OPEN MPFLOW
    |  +-----+  |     Marketplace ERP
    |           |
    +-----------+
     <-- 40px -->
```

### Minimum Size

| Variant | Minimum Width | Context |
|---------|---------------|---------|
| Full logo (mark + wordmark) | 160px | Website headers, docs |
| Mark only | 24px | Favicons, small UI elements |
| Mark only | 32px | App icons, sidebar headers |

### Logo Don'ts

- Do not rotate the logo
- Do not stretch or distort the aspect ratio
- Do not change the gradient colors
- Do not add drop shadows or outer glows to the logo
- Do not place the logo on busy or patterned backgrounds without sufficient contrast
- Do not use the wordmark without the mark
- Do not recreate the flow lines -- always use the provided SVG assets

---

## 4. Color Palette

The complete color system is defined in `brand/colors.css` as CSS custom properties. Below is the human-readable reference.

### Primary (Indigo)

The primary palette is the backbone of the brand. Indigo communicates precision, trust, and professionalism. It is used for all interactive elements, links, focus states, and brand-identifying surfaces.

| Token | Hex | Usage |
|-------|-----|-------|
| primary-50 | `#EEF2FF` | Selected backgrounds, subtle highlights |
| primary-100 | `#E0E7FF` | Hover backgrounds, light tints |
| primary-200 | `#C7D2FE` | Borders on selected items |
| primary-300 | `#A5B4FC` | Light mode secondary interactive |
| primary-400 | `#818CF8` | Dark mode interactive elements |
| **primary-500** | **`#6366F1`** | **Primary interactive (links, buttons, focus rings)** |
| primary-600 | `#5046E5` | Button hover, gradient end |
| primary-700 | `#4338CA` | Active/pressed states |
| primary-800 | `#3730A3` | Deep emphasis |
| primary-900 | `#312E81` | Dark surfaces |
| primary-950 | `#1E1B4B` | Deepest brand surface |

### Secondary (Purple)

Purple appears in gradients, decorative elements, and marketing surfaces. It adds warmth and energy to the primary indigo. Never use purple for functional UI elements -- reserve it for visual flair.

| Token | Hex | Usage |
|-------|-----|-------|
| secondary-300 | `#D8B4FE` | Light gradient highlights |
| secondary-400 | `#C084FC` | Gradient midpoints |
| secondary-500 | `#A855F7` | Decorative accents |
| secondary-600 | `#9333EA` | Marketing emphasis |
| secondary-700 | `#7E22CE` | Deep decorative |

### Neutral (Slate)

The neutral palette provides the foundation for all text, borders, and background surfaces. Slate has a cool blue undertone that harmonizes with the indigo primary.

| Token | Hex | Usage |
|-------|-----|-------|
| neutral-25 | `#FBFCFD` | Lightest surface |
| neutral-50 | `#F8FAFC` | Page background (light mode) |
| neutral-100 | `#F1F5F9` | Card backgrounds, alternating rows |
| neutral-200 | `#E2E8F0` | Borders, dividers |
| neutral-300 | `#CBD5E1` | Input borders, disabled elements |
| neutral-400 | `#94A3B8` | Placeholder text, sidebar text |
| neutral-500 | `#64748B` | Secondary text, labels |
| neutral-600 | `#475569` | Dark mode borders |
| neutral-700 | `#334155` | Dark mode input backgrounds |
| neutral-800 | `#1E293B` | Dark mode surfaces, sidebar hover |
| neutral-900 | `#0F172A` | Dark mode page background, sidebar |
| neutral-950 | `#020617` | Deepest dark surface |

### Semantic Colors

| Function | Light | Dark | Usage |
|----------|-------|------|-------|
| Success | `#059669` | `#34D399` | Positive KPIs, received orders, good margin |
| Warning | `#D97706` | `#FBBF24` | Caution states, moderate margin |
| Danger | `#EF4444` / `#DC2626` | `#F87171` | Errors, deletions, bad margin |
| Info | `#3B82F6` | `#60A5FA` | Informational badges, Ozon brand |

### Marketplace Accents

| Marketplace | Background | Text |
|-------------|------------|------|
| Ozon | `#EFF6FF` / `rgba(37,99,235,0.15)` | `#2563EB` / `#60A5FA` |
| 1688 | `#FFF7ED` / `rgba(234,88,12,0.15)` | `#EA580C` / `#FB923C` |

### Brand Gradients

| Name | Value | Usage |
|------|-------|-------|
| `gradient-brand` | `135deg, #7C6AED -> #5046E5` | Logo mark, primary CTAs |
| `gradient-brand-lg` | `135deg, #8B7CF6 -> #6366F1 -> #4F46E5` | Hero buttons, feature cards |
| `gradient-hero` | `135deg, #0F172A -> #1E1B4B -> #312E81` | Login page, hero sections |
| `gradient-surface` | `180deg, #F8FAFC -> #EEF2FF` | Subtle page backgrounds |
| `gradient-glow` | `radial, rgba(99,102,241,0.12) -> transparent` | Top-of-page glow effect |

### Margin Indicator Colors

Used specifically in financial/analytics contexts:

| Margin Quality | Light | Dark | Threshold |
|----------------|-------|------|-----------|
| Good | `#059669` | `#34D399` | > 30% |
| Moderate | `#D97706` | `#FBBF24` | 15-30% |
| Bad | `#DC2626` | `#F87171` | < 15% |

---

## 5. Typography

### Font Family

**Inter** is the sole typeface for all OpenMPFlow surfaces. It is a modern, open-source sans-serif designed for screens, with excellent legibility at small sizes and a professional, neutral character.

```css
font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

Load via Google Fonts with weights 400, 500, 600, 700, 800:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

### Code Font

For code blocks, terminal output, API references, and MCP tool names:

```css
font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
```

### Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `display-lg` | 48px / 3rem | 800 | 1.1 | -0.025em | Landing hero headline |
| `display-md` | 36px / 2.25rem | 800 | 1.15 | -0.02em | Section hero headlines |
| `display-sm` | 30px / 1.875rem | 700 | 1.2 | -0.015em | Page titles |
| `heading-lg` | 24px / 1.5rem | 700 | 1.3 | -0.01em | Card/section headings |
| `heading-md` | 20px / 1.25rem | 600 | 1.35 | -0.005em | Sub-section headings |
| `heading-sm` | 16px / 1rem | 600 | 1.4 | 0 | Widget headings |
| `body-lg` | 16px / 1rem | 400 | 1.6 | 0 | Primary body text |
| `body-md` | 14px / 0.875rem | 400 | 1.5 | 0 | Default UI text, table cells |
| `body-sm` | 12px / 0.75rem | 400 | 1.5 | 0 | Captions, helper text, badges |
| `body-xs` | 11px / 0.6875rem | 500 | 1.4 | 0.02em | Micro labels, timestamps |
| `label` | 12px / 0.75rem | 500 | 1.4 | 0 | Form labels |
| `overline` | 11px / 0.6875rem | 700 | 1.4 | 0.08em | Section overlines, uppercase labels |
| `code` | 13px / 0.8125rem | 400 | 1.6 | 0 | Inline code, API references |

### Heading Hierarchy in Documentation

For Fumadocs and markdown-rendered content:

| Element | Size | Weight | Color (Light) | Color (Dark) |
|---------|------|--------|---------------|--------------|
| h1 | 36px | 800 | neutral-900 | neutral-50 |
| h2 | 24px | 700 | neutral-900 | neutral-100 |
| h3 | 20px | 600 | neutral-800 | neutral-200 |
| h4 | 16px | 600 | neutral-700 | neutral-300 |
| p | 16px | 400 | neutral-600 | neutral-400 |

### Text Rendering

Always apply antialiasing for crisp text:

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
```

---

## 6. Iconography

### Style

OpenMPFlow uses **outline-style** icons from the Heroicons library (24px, 1.5px stroke). This matches the clean, professional aesthetic and integrates natively with Tailwind CSS.

**Icon source:** [Heroicons](https://heroicons.com/) -- Outline variant (not solid, not mini).

### Guidelines

- **Size:** 20px (sidebar navigation, inline), 24px (page actions), 16px (table actions, small UI)
- **Stroke:** 1.5px (default), never thicker than 2px
- **Color:** inherit from text color via `currentColor`
- **Alignment:** always vertically centered with adjacent text
- **Spacing:** 8-12px gap between icon and label text
- **Interactive icons:** include a hover state (color transition to primary-500)

### Section Icons (Admin UI Sidebar)

| Section | Icon | Heroicons Name |
|---------|------|----------------|
| Каталог | Archive box | `archive-box` |
| Закупки | Shopping bag | `shopping-bag` |
| Аналитика | Bar chart | `chart-bar` |
| Планирование | Clipboard document | `clipboard-document-list` |
| Логистика | Truck | `truck` |
| Финансы | Banknotes | `banknotes` |
| Цены | Calculator | `calculator` |
| Настройки | Cog | `cog-6-tooth` |
| MCP | Command line | `command-line` |

---

## 7. Visual Patterns & Textures

### Brand Pattern (Flow Lines)

The primary brand pattern (`brand/patterns.svg`) combines three layers:

1. **Grid Dots** -- A regular grid of small circles (0.8px radius, 40px spacing, 10% opacity) providing a subtle data-grid texture
2. **Flow Lines** -- Sinusoidal curves (matching the logo motif) that repeat at 200px intervals, evoking data streams moving through a system
3. **Diagonal Connectors** -- Light diagonal lines suggesting network connections between data points

**Usage:**
- Landing page hero background (behind heading text)
- Documentation page sidebars and headers
- Auth/login page as a subtle background layer
- Marketing collateral backgrounds
- Empty states within the admin UI

**Application rules:**
- Always place patterns behind content, never over it
- Use at low opacity (the SVG is pre-tuned, but can be further reduced via CSS opacity)
- On dark backgrounds, invert to use lighter stroke colors or apply `filter: invert(1)` and reduce opacity
- Patterns should tile seamlessly -- the SVG is designed for `background-repeat: repeat`

```css
/* Light background usage */
.pattern-bg {
  background-image: url('/brand/patterns.svg');
  background-size: 800px 800px;
  background-repeat: repeat;
}

/* Dark background usage */
.pattern-bg-dark {
  background-image: url('/brand/patterns.svg');
  background-size: 800px 800px;
  background-repeat: repeat;
  filter: invert(1);
  opacity: 0.4;
}
```

### Alternative Pattern: Dot Grid

For simpler contexts (modal backgrounds, card surfaces), use a standalone dot grid:

```css
.dot-grid {
  background-image: radial-gradient(circle, var(--color-primary-500) 0.8px, transparent 0.8px);
  background-size: 24px 24px;
  opacity: 0.06;
}
```

### Gradient Overlays

Layer subtle gradients over patterns for depth. The brand glow effect adds a soft indigo radial highlight at the top of pages:

```css
.glow-overlay {
  background: var(--gradient-glow);
  pointer-events: none;
  position: absolute;
  inset: 0;
}
```

---

## 8. UI Component Guidelines

### Buttons

**Primary Button:**
- Background: `primary-500` (hover: `primary-600`, active: `primary-700`)
- Text: white, 14px, weight 600
- Padding: 10px 16px
- Border-radius: `radius-md` (8px)
- Transition: background-color 150ms ease
- Shadow: none at rest, `shadow-sm` on hover (optional)

**Secondary Button (Ghost):**
- Background: transparent (hover: `primary-50`)
- Text: `primary-500`, 12-14px, weight 500
- Border: none
- Border-radius: `radius-sm` (6px)

**Danger Button:**
- Background: `danger-600` (hover: `danger-700`)
- Text: white
- Same sizing as primary

**Disabled Button:**
- Opacity: 0.5
- Cursor: not-allowed
- No hover state changes

### Form Inputs

- Background: white / `neutral-700` (dark)
- Border: 1px solid `neutral-300` / `neutral-600` (dark)
- Border-radius: `radius-md` (8px)
- Padding: 8px 12px
- Font: 14px / 400
- Focus: 2px ring in `primary-500`, border becomes transparent
- Placeholder: `neutral-400`
- Transition: border-color 150ms, box-shadow 150ms

### Cards

- Background: white / `neutral-900` (dark)
- Border: 1px solid `neutral-200` / `neutral-700` (dark)
- Border-radius: `radius-lg` (12px)
- Shadow: `shadow-sm` at rest, `shadow-md` on hover (if interactive)
- Padding: 16-24px
- No maximum width (responsive to container)

### Tables

- Header: `neutral-50` / `neutral-800` background, `neutral-500` text, 12px weight 600, uppercase
- Cell padding: 8px 16px
- Row dividers: 1px solid `neutral-100` / `neutral-800` (dark)
- Hover rows: `neutral-50` / `neutral-800/50` (dark) -- subtle highlight
- Sortable headers: cursor pointer, hover color `primary-500`
- Sort indicator: small arrow, opacity 0.3 (inactive), full opacity + `primary-500` (active)

### Badges

- Border-radius: `radius-full` (pill)
- Padding: 2px 8px
- Font: 10px, weight 700, uppercase, letter-spacing 0.04em
- Status badges: background + text color from semantic palette
- Marketplace badges: Ozon blue, 1688 orange

| Badge | Light BG | Light Text | Dark BG | Dark Text |
|-------|----------|------------|---------|-----------|
| Muted | `#F1F5F9` | `#64748B` | `#334155` | `#94A3B8` |
| Success | `#ECFDF5` | `#059669` | `rgba(5,150,105,0.15)` | `#34D399` |
| Warning | `#FFFBEB` | `#D97706` | `rgba(217,119,6,0.15)` | `#FBBF24` |
| Ozon | `#EFF6FF` | `#2563EB` | `rgba(37,99,235,0.15)` | `#60A5FA` |
| 1688 | `#FFF7ED` | `#EA580C` | `rgba(234,88,12,0.15)` | `#FB923C` |

### Toasts

- Border-radius: `radius-lg` (12px)
- Shadow: `shadow-lg`
- Padding: 12px 16px
- Max-width: 384px
- Font: 14px, weight 500
- Auto-dismiss: 3.5 seconds
- Animation: slide up + fade in (300ms), fade out (300ms)
- Colors: success = `#059669`, error = `#DC2626`, info = `neutral-800`
- Always white text on colored backgrounds

### Drawers (Slide-Over Panels)

- Width: 550px (forms), 900px (detail views), 100vw (mobile)
- Background: white / `neutral-900` (dark)
- Border-left: 1px solid `neutral-200` / `neutral-800` (dark)
- Shadow: `-10px 0 40px rgba(0,0,0,0.1)`
- Backdrop: rgba(0,0,0,0.4) + blur(4px)
- Animation: slide in from right 300ms cubic-bezier(0.4, 0, 0.2, 1)

### Modals

- Max-width: varies by content (typically 480-640px)
- Max-height: 85vh with overflow-y auto
- Border-radius: `radius-xl` (16px)
- Shadow: `shadow-2xl`
- Backdrop: rgba(0,0,0,0.5) + blur(4px)
- Animation: scale(0.95) + translateY(8px) -> scale(1) + translateY(0), 200ms
- Padding: 24px

### Sidebar (Navigation)

- Width: 240px (desktop), full-width overlay (mobile)
- Background: `neutral-900` (always dark, regardless of theme mode)
- Text: `neutral-400` (inactive), white (active)
- Active indicator: 2px left border in `primary-500`, background `neutral-800`
- Logo area: separated by 1px bottom border in `neutral-800`
- Icon + label layout: 12px gap, 14px font, weight 500

### Scrollbars

- Width/height: 6px
- Track: transparent
- Thumb: `neutral-300` (light) / `neutral-700` (dark)
- Thumb hover: `neutral-400` / `neutral-600` (dark)
- Border-radius: full

---

## 9. Dark & Light Mode

### Philosophy

OpenMPFlow supports both light and dark modes. The sidebar is always dark (slate-900) regardless of mode, creating a consistent navigation anchor. Content areas switch between light (slate-50 page, white cards) and dark (slate-950 page, slate-900 cards).

### Implementation

Mode is toggled via the `dark` class on the `<html>` element, stored in `localStorage`. Use Tailwind's `dark:` variant for styling or CSS custom properties from `brand/colors.css`.

### Key Differences

| Element | Light Mode | Dark Mode |
|---------|------------|-----------|
| Page background | `#F8FAFC` | `#020617` |
| Card background | `#FFFFFF` | `#0F172A` |
| Primary text | `#0F172A` | `#F1F5F9` |
| Secondary text | `#64748B` | `#94A3B8` |
| Borders | `#E2E8F0` | `#334155` |
| Interactive | `#6366F1` | `#818CF8` |
| Focus ring | `#6366F1` | `#6366F1` (same) |
| Shadows | Light, subtle | Stronger, deeper |
| Semantic colors | Saturated | Lighter, higher contrast |

### Gradient Adjustments

In dark mode, gradients shift slightly brighter to maintain visual presence:
- Brand gradient start: `#7C6AED` -> `#8B7CF6`
- Hero gradient: deeper blacks with indigo accents
- Surface gradient: neutral-900 base with indigo-950 tint

---

## 10. Voice & Tone

### Brand Voice

OpenMPFlow speaks like a knowledgeable colleague who respects your time. We are:

- **Clear** -- We say what we mean in the fewest words necessary. No jargon for jargon's sake.
- **Confident** -- We know our domain (marketplace operations, unit economics, supply chain) and communicate with authority.
- **Helpful** -- We guide, not lecture. Every message should help the user take their next step.
- **Professional** -- We treat sellers as business operators, not beginners. The tone is B2B, not consumer.

### Tone Guidelines

| Context | Tone | Example |
|---------|------|---------|
| UI labels & buttons | Direct, concise | "Оприходовать" not "Нажмите для оприходования заказа" |
| Error messages | Calm, actionable | "Не удалось синхронизировать остатки. Проверьте API-ключ Ozon в настройках." |
| Success messages | Brief, confirmatory | "Заказ оприходован. Создано 3 лота FIFO." |
| Empty states | Encouraging, instructive | "Пока нет товаров. Импортируйте каталог из Ozon или добавьте первый товар." |
| Documentation | Thorough, structured | Use headers, code blocks, tables. Lead with "what", then "how", then "why". |
| Marketing (landing) | Aspirational, benefit-led | "Know your margins. Control your supply chain. Grow with confidence." |
| Changelog / updates | Factual, scannable | Lead with the feature name, then one sentence on what it does. |

### Language

- **Admin UI:** Russian (the primary audience is Russian-speaking Ozon sellers)
- **Documentation site:** English (open-source, international audience)
- **Code, API, MCP tools:** English
- **Marketing / landing:** English + Russian variants

### Writing Rules

1. **Use active voice.** "Система рассчитала себестоимость" not "Себестоимость была рассчитана системой."
2. **Lead with the outcome.** "Остатки синхронизированы" not "Процесс синхронизации остатков завершён успешно."
3. **Avoid filler words.** Remove "пожалуйста", "просто", "всего лишь" from UI copy.
4. **Numbers are precise.** Show exact values: "12 345 rub" not "около 12 тыс."
5. **Abbreviations:** Use standard business abbreviations (UE, P&L, DDS, FIFO, SKU) without expansion -- the audience knows them.
6. **Formatting numbers:** Use non-breaking space as thousands separator (Russian standard): `12 345,67 rub`, not `12,345.67`.

---

## 11. Application Examples

### Admin UI (admin.mp-flow.ru)

The admin UI is the primary product surface. It follows all guidelines above directly. Key implementation notes:

- Sidebar: always dark, 240px, slate-900 background
- Content area: responsive, min 1024px optimized, full mobile support
- Tables: full-width, horizontal scroll on overflow
- Logo in sidebar: flow mark (32px) + "OPENMPFLOW" overline + "ERP Console" subtitle
- Login page: full-screen `gradient-hero` background, centered white card

### Documentation Site (Fumadocs)

- Use the same Inter typeface
- Header: white/slate-900 background with logo (full variant), navigation links
- Sidebar: file-tree navigation, indigo active indicator
- Content: max-width 720px, generous line height (1.7 for body text)
- Code blocks: JetBrains Mono, slate-900 background, indigo syntax highlights
- Apply `gradient-glow` at the top of pages for subtle brand presence

### Landing Page

- Hero section: `gradient-hero` background with brand pattern overlay
- Logo: `logo-dark.svg` in the header
- CTAs: gradient buttons (`gradient-brand-lg`), white text, rounded-lg
- Feature cards: white cards with subtle `shadow-md`, hover `shadow-lg`
- Stats/numbers: display-lg size, primary-500 color
- Footer: slate-900 background, slate-400 text

### Logto Auth Page (auth.mp-flow.ru)

- Background: `gradient-hero`
- Card: white/slate-800, rounded-2xl, shadow-2xl, centered
- Logo: flow mark (40px) + brand name, centered at top of card
- Inputs: standard form-input styles
- Submit button: primary button style, full-width

### Favicons & App Icons

| Size | Source | Usage |
|------|--------|-------|
| SVG | `brand/favicon.svg` | Modern browsers |
| 32x32 | Rasterized from favicon.svg | Legacy browsers |
| 180x180 | Rasterized, with padding | Apple Touch Icon |
| 192x192 | Rasterized, with padding | Android PWA |
| 512x512 | Rasterized, with padding | PWA splash |

For rasterized versions, add 12.5% padding (transparent) around the mark and use a white or slate-950 background circle/rounded-rect behind the mark for visibility.

### Open Graph / Social Cards

- Size: 1200x630px
- Background: `gradient-hero`
- Pattern overlay: `patterns.svg` at 30% opacity
- Logo: `logo-dark.svg`, centered upper third
- Title text: display-md, white, centered
- Subtitle: body-lg, slate-300, centered below title

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `brand/BRANDBOOK.md` | This document |
| `brand/colors.css` | CSS custom properties (light + dark mode) |
| `brand/logo.svg` | Primary logo for light backgrounds |
| `brand/logo-dark.svg` | Logo variant for dark backgrounds |
| `brand/favicon.svg` | Square mark for browser tabs |
| `brand/patterns.svg` | Tileable background pattern |

---

*OpenMPFlow Brand Book v1.0 -- February 2026*

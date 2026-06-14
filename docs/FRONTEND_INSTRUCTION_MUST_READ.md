# FRONTEND — INSTRUCTION & DESIGN CANON (MUST READ FIRST)

> **STATUS: CLIENT-APPROVED · SINGLE SOURCE OF TRUTH (SSOT) FOR FRONTEND.**
> Read this **before writing any frontend code** — human or AI. When it comes to look, feel, shell, and interaction, **this file wins.** The client has approved the design in `docs/frontend-demo/index.html`; that file is the **visual reference build** this document describes. Do not invent a different look.

**The three companions you must always open together:**
1. **This file** — the canon (rules, design system, shell, the 10-question gate).
2. **`docs/frontend-demo/index.html`** — the approved visual reference (shell, tokens, components, interactions in working form).
3. **The hub-system client** (`client folder for hub-system/`) — the engineering we are cloning. **Always confer with it.** Our job is to match its engineering and then make it **simpler and better**. If hub-system does something we can do more simply, do it more simply — and note why.

Field/endpoint truth still comes from the **migration SQL** then **`docs/openapi.yaml`** then **`Frontend_Engineering_Guide_v2.2.md`** (UI/behaviour per module). This file governs *how it looks and feels*; those govern *what data and screens exist*.

---

## 0. THE 10-QUESTION GATE (MANDATORY before building any module)

**Before writing a single line of a frontend module, the AI MUST ask the user exactly 10 questions** covering **preference, engineering, and backend connection**, referencing hub-system where relevant. Rules:

- Each question has **three options: A, B, C**, and the AI marks **one as "(Recommended)"** with a one-line reason.
- Cover, across the 10: (1) which module/screens & scope, (2) primary user role & permissions, (3) the exact API endpoints/contract + entity-scope header, (4) list vs board vs detail layout, (5) create/edit pattern (Drawer vs Modal vs page), (6) real-time needs (Socket.io rooms), (7) state-machine / workflow gating, (8) money/multi-currency display, (9) empty/loading/error/permission states & mobile behaviour, (10) how it mirrors or simplifies the hub-system equivalent.
- **Only skip the gate if the user explicitly cancels it or asks for more/fewer questions.** Otherwise, ask, wait for answers, then build.
- The resulting build **must respect this canon** (§1–§9). Answers tune the module; they never override the design system, the palette, the shell, or the non-negotiables.

A new chat building a module starts **here**: read this file → ask the 10 questions → confer with hub-system + the migration/OpenAPI → build to canon.

---

## 1. The brand & the one-paragraph brief

We build **two surfaces** on one system: the **Hub** (ERP / back-office, React PWA) and the **Storefront** (Next.js SSR). The Hub must feel **as easy as WhatsApp/Instagram** — never as dense as Zoho/Odoo/SAP/Sage — while being **beautiful, luxurious, and unmistakably Pixie Girl**. **Mobile-first**, flawless desktop responsiveness, **PWA standards** (installable, offline-tolerant shell, `theme-color`, safe-area insets). Everything is **data/token-driven** so the product is **white-label**: clone it, re-skin per client with config, not code.

---

## 2. DESIGN SYSTEM (locked)

### 2.1 Palette — "Maroon Noir" (Pixie Girl is deep red, used sparingly)
Tokens are `R G B` triplets consumed as `rgb(var(--token) / <alpha>)` (hub-system convention).

**Dark (default):** `--bg:15 8 9` (near-black, maroon pinch) · `--panel:26 15 17` · `--panel-2:39 22 25` · text **warm cream** `--text:244 233 217`, `--text-muted:179 164 155`, `--text-faint:128 112 107` · hairline `--border-c:244 233 217 / .08`.
**Accent ramp (deep red):** `--accent-deep:105 9 9` (#690909 — anchor; *filled buttons with cream text*) · `--accent:168 29 29` (#A81D1D — working: borders/icons/links, legible on black) · `--accent-glow:216 92 87` (focus/hover).
**Light (pure/near-white):** `--bg:251 250 249`, `--panel:255 255 255`, text `--text:26 16 17`; **accent = pure #690909** (great contrast on white); `--info` reuses Pixie's intl blue `#1878B9`.
**Semantic (so brand-red ≠ error):** success `127 160 106` sage · warn `201 162 75` gold · **danger `229 84 78` scarlet** (hotter than maroon) · info as above.
**Rule:** the accent is used **sparingly — never a loud fill** behind text. Primary buttons = `#690909` fill + cream text. Tiles/cards = glass with cream text and a *subtle* accent icon/edge. Never pure white as a surface in dark; never black-on-red text.

### 2.2 Brand layer (Layer B)
Per business, tints only the brand chip, the ambient gradient wash, and icon medallions:
- **Pixie Girl:** deep red `#690909` + cream `#F4E9D9` (gradient `#A81D1D → #690909`).
- **Faitlyn:** bronze `#7F703D` + nude `#D5B8A4` (gradient `#7F703D → #D5B8A4`).

### 2.3 Two-layer theming (the white-label spine)
- **Layer A — App Appearance** (`--bg/--panel/--text/--accent…`): the platform skin, edited in **Settings → Appearance** (presets: Maroon Noir, Porcelain White, Onyx Ruby, Oxblood Luxe). Backend: a singleton `shared.app_appearance` (flag if absent; until then seed from env).
- **Layer B — Brand Appearance** (`--biz-1/--biz-2/--biz-accent`): per `business_config`. Hub chrome stays consistent across businesses; only the chip/ambient retint.
- **Never inline a hex, font, or radius. Read the variable.**

### 2.4 Typography (legible, luxe)
- **Display/headings & key numerals:** **Playfair Display** (fashion-editorial serif).
- **Body/UI:** **Montserrat**. **Mono/figures:** **JetBrains Mono** (tabular money).
- Micro-labels: uppercase, letter-spacing ~.18em, `--text-faint`. Keep all text high-contrast and legible — clarity beats decoration.

### 2.5 Glassmorphism
Frosted translucent surfaces everywhere (`backdrop-filter: blur(~22px) saturate(150%)`, hairline border, soft glow shadow). **All dropdowns/menus/palette/drawers keep the glass treatment.** Living brand-colour mesh gradient sits behind the glass (lower opacity in light mode).

---

## 3. THE SHELL (locked layout — clone of hub-system, simplified)

### 3.1 Sidebar (desktop rail 264px / collapsed 78px; mobile drawer)
- **Brand** at top: monogram in an accent ring + product wordmark (accent tail word) + tagline.
- **Business switcher** directly below — **logo + business name only** (no subtitle). Click → **glass dropdown** of businesses (logo + name + check). **No "All Businesses"** option — businesses have separate data; *only the Dashboard* may aggregate across businesses. (≤2 businesses may simply toggle; 3+ uses the dropdown.)
- **Nav = Priority (top-10) + collapsible "More"** grouped Run / Operate / Finance / People / Grow / System. **Settings is a module** present in both the sidebar (System) and the app grid — one source list, so they never drift.
- **Active app** is highlighted (accent left-border + glass) **and the sidebar auto-scrolls it into view** when opened.
- **Account** footer row (avatar + name + role). Click (works collapsed too) → **glass dropdown**: header (name + email), then **Change photo · My profile · My HR · Quick login PIN · Change password · Sign out**.
- **Floating collapse handle**: a small circular button on the **sidebar's right edge** (chevron rotates, subtle scale/glow). Desktop only.

### 3.2 Top bar (sticky, inside content — do NOT remove it)
Left: **module title + description** (e.g. "Hub · Your command center"; "Sales · Orders, quotes & payments"). Right tools: **Clock-in button + live timer** (geofenced) · **Search "Search Hub… ⌘K"** (this is one of the most important elements — global navigation/find) · **Notification bell** · **Light/dark toggle**. Mobile: hamburger (opens sidebar drawer) + compact title + search icon + bell.

### 3.3 Command Center (Home)
Hero: **"Good {morning/afternoon/evening}, {name}"** (dynamic), big serif **"What would you like to craft today?"**, dynamic sub-line, and a **live clock card** (HH:MM / weekday date / active business chip). Then the **App Grid** (top-10, **drag-to-reorder**, hover **pin/unpin**, **"More"** expands the rest grouped with pin-to-top; Dashboard anchored). Then **Recent activity** below the grid.

### 3.4 Global floating elements
- **App-Menu pill** (bottom-center): appears on **every app except the Command Center**; returns there so the user can launch another app. (Hidden on mobile — the bottom nav covers it.)
- **Floating launcher** (bottom-right): fans out to **Praxis AI · Messages · Help**. **Hover to expand on desktop; tap on mobile.** Carries the unread badge.
- **⌘K command palette**: glass modal, searches apps + quick actions + records; arrow/enter nav; Esc closes.
- **Mobile bottom nav**: Home · Search · Apps · Praxis. Sidebar becomes a drawer behind a scrim.

### 3.5 Module screen pattern
Every module screen lives under the shell, shows its title/desc in the top bar, highlights its sidebar entry, and offers the App-Menu pill to return. Build list/detail with the shared components (§5).

---

## 4. THE 10 NON-NEGOTIABLES (a violation is a bug)

1. **Entity scope on every call** — `activeEntity` (PXG/FLH) attached to every request + query key. No cross-business reads; only the Dashboard aggregates.
2. **The API is the only security boundary** (no DB RLS). Never request a hidden field (cost, salary, factory cost) for a role that can't see it.
3. **Permission-aware rendering** — read the permission matrix; no `view` → route-guard; no `edit` → read-only; no `delete`/`approve` → hide. The button's absence is never the enforcement.
4. **Render config from the DB** — thresholds, tax, prefixes, currencies, **colours/logos/fonts**. Never hard-code business values.
5. **Workflow-gated writes** submit to `workflow_instances`, not the target table; show the chain before submit.
6. **Money is NGN-based** with `display_currency` + stored `fx_rate_used`. Render via `MoneyText`; never recompute history with a live rate.
7. **Append-only/posted records are read-only** — reverse/adjust, never edit. State machines offer only valid transitions.
8. **Audit every write**; surface "updated by/at".
9. **Four states on every screen** — loading skeleton (matches layout), empty (CTA if permitted), error (retry, logged), permission-denied (clear panel).
10. **Two-layer theming + tokens only** (§2.3). No literal colours/fonts.

---

## 5. Stack & shared components (build once, reuse)

**Stack:** React PWA (Hub) · Next.js SSR (Storefront) · **Zustand** (client: auth, activeEntity, UI, theme) · **TanStack Query** (server data; mutations invalidate; optimistic for kanban/drag) · **Socket.io** (stock, notifications, messages, dashboards, Praxis run-steps) · schema-driven forms mirroring `payload_schema` · one `<Chart>` + one `<MapView>` wrapper · tokens via CSS variables. Access token in memory, refresh in httpOnly cookie — **never localStorage**.

**Primitives:** `AppShell` (sidebar + top bar + floating layer) · `Sidebar` (business switcher, Priority+More, account menu, collapse handle) · `TopBar` (title/desc, clock-in, search, bell, theme) · `BusinessSwitcher` · `AccountMenu` · `CommandPalette` (⌘K) · `AppGrid`/`AppTile` (drag, pin) · `AppMenuFab` · `FloatingLauncher` · `DataTable` (server-driven, 4 states, responsive→cards) · `Drawer`/`Modal`/`Popover` · `FormSection`/`FieldRow`/`SaveBar` · `MoneyText` · `StatusPill` · `KpiTile` · `Timeline` · `StateMachineStepper` · `WorkflowChain` · `EmptyState`/`Skeleton` · `MaskedField` · `CountdownTimer` · `PraxisPanel`. **All overlays use the glass treatment.**

---

## 6. Per-screen Definition of Done

- [ ] Four states (loading/empty/error/permission-denied).
- [ ] Permission-aware controls; read-only fallback.
- [ ] Entity scope on every call; no cross-business reads.
- [ ] Money via `MoneyText`; hidden fields never requested for unauthorised roles.
- [ ] Workflow-gated writes → `workflow_instances`; chain shown first.
- [ ] Config from DB; **tokens only**, no literal colours/fonts.
- [ ] Custom fields (`custom_field_defs`) rendered.
- [ ] State machines offer valid transitions; append-only = read-only.
- [ ] Real-time reconciled with cache; degrades gracefully.
- [ ] a11y: 44px targets, keyboard, focus, ARIA on table/drawer/menu, contrast under both themes, reduced-motion, never colour-only.
- [ ] Mobile verified first, then desktop; top bar + sidebar + floating elements behave per §3.
- [ ] Matches the approved demo's look; conferred with the hub-system equivalent (and simplified where possible).

---

## 7. Canonical decisions (resolve with owner before the affected screen)
D-1 loyalty thresholds · D-2 stylist tiers · **D-3 KPI weights must sum to 100 (UI is the only guard)** · D-7 fee pass-through (one clean total, never a "+₦X fee" line) · D-8 manual-payment button hidden unless `allow_staff_manual_payments`. Backend-blocked (build behind a flag): e-signature, hair quiz, extended Streak-Stars, wishlist, POS offline idempotency, the **App Appearance table**. (See `Frontend_Engineering_Guide_v2.2.md` §0.5 / Appendix C.)

---

## 8. White-label discipline
"Clone" = one shared codebase deployed N times, **configured per client — never a fork edited per client**. Everything brandable is data (App Appearance, brand appearance, copy, currencies, tax, roles, categories, pricing, flags). Logic stays in parameterised code, never in DB rows. A new client goes live by setting **one App Appearance row + their brand rows + config** — nothing else.

---

## 9. How to start a module (the loop)
1. Open **this file** + **`docs/frontend-demo/index.html`** + the **hub-system** equivalent + the module's **migration** + **OpenAPI**.
2. **Ask the 10 questions** (§0) — A/B/C + a recommendation each — unless the user cancels.
3. Build to canon (§2–§6), cloning hub-system's engineering and **simplifying** it.
4. Run the Definition of Done (§6). Flag any canon conflict instead of silently diverging.

*This is the styling SSOT. The migration SQL and OpenAPI are field/endpoint truth; `Frontend_Engineering_Guide_v2.2.md` is per-module UI detail; the hub-system client is the engineering reference. Where look & feel is concerned, this document — and the approved demo it describes — is final.*

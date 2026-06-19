# Pixie Girl Hub — Admin (ERP) Frontend Foundation

The **foundation kit** every Hub module builds on. Implements the client-approved
design canon: **`../../docs/FRONTEND_INSTRUCTION_MUST_READ.md`** (SSOT). The
working visual reference is **`../../docs/frontend-demo/index.html`**; the
engineering we cloned-and-simplified is the **hub-system** client.

> **Building a module? Start at the canon and run its question gate (10–15
> questions) before writing code. Always confer with `Frontend_Engineering_Guide_v2.2.md`,
> the migrations, and `openapi.yaml`.** This package gives you the shell + primitives;
> you add the screens.

## Stack

React 18 · TypeScript · Vite · Tailwind (CSS-variable token system) · Zustand
(client state) · TanStack Query (server state) · React Router · lucide-react.

## Run

```bash
npm install
cp .env.example .env   # set VITE_API_URL
npm run dev            # http://localhost:5173
npm run build          # tsc -b && vite build
```

## What's in the foundation

- **Theming (canon §2):** `src/styles/index.css` — "Maroon Noir" tokens, light
  mode, two-layer theming (Layer A platform / Layer B business). `tailwind.config.ts`
  maps tokens. `ThemeProvider` applies theme + business gradient at runtime.
- **Shell (canon §3):** `AppShell`, `Sidebar` (business switcher, Priority top-10 +
  collapsible More, account menu, floating collapse handle), `TopBar` (module
  title/desc · clock-in + timer · ⌘K search · bell · theme), `AppMenuFab`
  (draggable "Back" pill, glass + deep-red gradient), `FloatingLauncher`
  (Praxis/Messages/Help — hover desktop, tap mobile), `MobileBottomNav`,
  `CommandPalette` (⌘K).
- **Command Center:** `pages/CommandCenter.tsx` — greeting + live clock + business
  chip, `AppGrid` (drag-to-reorder, pin/unpin, grouped More), recent activity.
- **UI primitives (canon §5):** `Button`, `IconButton`, `Card`, `Pill`,
  `StatusPill`, `KpiTile`, `MoneyText`, `MaskedField`, `Skeleton`, `EmptyState`,
  `DataTable`, `Drawer`, `Modal`, `Form` (FormSection/Field/TextInput/SaveBar),
  `Timeline`.
- **Stores:** `ui` (theme/density/collapse/palette/fab-offset), `auth`
  (user + `can()` permission check), `business` (active entity), `nav` (top-10
  pin/reorder, shared by grid + sidebar).
- **Example module:** `pages/SalesPage.tsx` (KPIs + DataTable + Payment Workbench
  drawer). Every other module route renders `ModulePlaceholder` until built.

## How a new module slots in

1. Add (or confirm) the module in `src/lib/modules.ts` (it already lists all 25).
2. Run the canon's **question gate**; search the backend for flaws first.
3. Create `pages/<module>/…`, compose the primitives, wire TanStack Query to the
   API with the entity-scope header.
4. Add its route in `src/router.tsx` (replacing the placeholder).
5. Run the per-screen Definition of Done (canon §6).

## Notes / backend dependencies

- Auth, data, and real-time are **stubbed** here (demo user, mock rows). Wire to
  the backend API + Socket.io on integration; keep the access token in memory and
  the refresh token in an httpOnly cookie (never localStorage).
- **Appearance persistence** needs `shared.app_appearance` (flagged in the canon).
  Until then, theme/density persist locally and accent edits are runtime-only.

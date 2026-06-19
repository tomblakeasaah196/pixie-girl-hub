# Desktop UX Playbook (admin app)

How to make the admin frontend feel like a real desktop product **without
changing the phone experience**. Read this before touching any screen for the
desktop pass. It encodes the foundation shipped in the "Desktop UX foundation"
commit.

## The one rule that matters

> **The phone tier (≤767px) is frozen.** Every desktop change must be _additive
> at the desktop tier only_. If a change could alter rendering at ≤767px, it is
> wrong.

This is mechanically enforceable because of how the stack works (Tailwind v3 +
one global stylesheet):

- A `lg:` / `xl:` utility emits a `min-width` media query (1024px / 1280px). It
  is **inert below that width** — adding `lg:foo` can never change a phone.
- A new `@media (min-width: 1024px) { … }` block in `index.css` is inert below
  1024px by construction.
- **Never** edit an _unprefixed_ class that currently styles a phone, and
  **never** touch a `max-md:` / `max-width` rule or the `@media (max-width:768px)`
  block — those are the phone's.

So: to improve desktop, you **add** `lg:`/`xl:` classes (or `min-[1024px]:`).
You do not rewrite the base classes.

## The three tiers

`apps/admin/src/hooks/useMediaQuery.ts`:

| Tier    | Width      | Hook             | Chrome                                          |
| ------- | ---------- | ---------------- | ----------------------------------------------- |
| Phone   | ≤767px     | `useIsPhone()`   | drawer sidebar + bottom nav (frozen)            |
| Tablet  | 768–1023px | `useIsTablet()`  | drawer sidebar + bottom nav, fluid full width   |
| Desktop | ≥1024px    | `useIsDesktop()` | rail sidebar, centered container, master-detail |

`useIsDesktop()` is the structural switch. Use it for _layout-shape_ decisions
(split vs stacked); use `lg:`/`xl:` classes for _styling_ decisions.

## Foundation you build on (already shipped — reuse, don't reinvent)

- **Content container** — `AppShell` centers page content at
  `max-w-[var(--content-max)]` (1440px). You get this for free; don't add your
  own page-level `max-w` unless a screen needs to be _narrower_ (then also add
  `mx-auto` so it centers, never left-anchored).
- **`Modal` `size` prop** (`components/ui/Modal.tsx`): `sm` (460, default) ·
  `md` (640) · `lg` (860) · `xl` (1100). Width is `min(94vw, size)` so phones
  are always 94vw. The panel is height-capped and body-scrolls — headers never
  clip. **Use `lg`/`xl` for real forms.**
- **`FormGrid`** (`components/ui/Form.tsx`): `<FormGrid cols={2|3}>` → 1 column
  on phone, 2/3 from `md:` up. Wrap field pairs/groups in it.
- **`Drawer`** widens on desktop automatically (`lg:`/`xl:`). For rich detail,
  pass `wide`.
- **`DataTable`** rows tighten on desktop automatically.
- **`PageActions`** (`components/shell/PageActions.tsx`): wrap a page's primary
  CTA(s) in `<PageActions>…</PageActions>` — on desktop they teleport into the
  top bar; on phone/tablet they render inline where you placed them.
- **Themed `Select`** (`components/ui/controls.tsx`): use it for dropdowns in
  forms. **Do not** use native `<select>` in forms (it renders as a bare OS
  widget and breaks the glass theme).

## Patterns

### 1. Forms (modals)

- Open long/medium forms with `<Modal size="xl">` (or `lg`).
- Lay sections into two columns on desktop:
  ```tsx
  <div className="lg:grid lg:grid-cols-2 lg:gap-x-8 lg:items-start">
    <div>{/* sections A */}</div>
    <div>{/* sections B */}</div>
  </div>
  ```
  On phone the inner `div`s are plain blocks → sections stack in source order
  (unchanged). Keep any existing `grid-cols-2` field rows as-is (they were
  already 2-up on phone — don't "fix" them, that would change phone).
- Replace native `<select>` with the themed `Select`.
- Reference exemplar: `pages/contacts/ContactFormModal.tsx`.

### 2. List / index pages → master-detail on desktop

Goal: on desktop the list stays on the left and the selected record's detail
shows in a right pane (no scrim); on phone/tablet, keep today's full-width list

- overlay drawer.

Recipe:

1. Extract the drawer's body into a reusable `XDetailPanel({ id })` component.
   The existing drawer becomes `<Drawer …><XDetailPanel id=… /></Drawer>`.
2. In the list page:
   ```tsx
   const isDesktop = useIsDesktop();
   …
   {isDesktop ? (
     <div className="grid grid-cols-[minmax(380px,460px)_1fr] gap-5 items-start">
       <div className="min-w-0">{/* list (table or rail) */}</div>
       <div className="min-w-0">
         {selectedId ? <XDetailPanel id={selectedId} /> : <SelectPrompt />}
       </div>
     </div>
   ) : (
     <>
       {/* full-width list */}
       <XDetailDrawer id={selectedId} onClose={…} />
     </>
   )}
   ```
3. Provide an empty "select a record" prompt for the right pane (one of the
   four states).

Priority candidates: Contacts, Cash & Expenses (approval queue), IAM Users.
Where detail is already a full page (e.g. CRM deal), master-detail is optional;
prefer keeping list context only if cheap.

### 3. Page primary actions → top bar on desktop

Wrap the page's primary button(s):

```tsx
<PageActions>
  <Button variant="primary" icon={<Plus/>} onClick={…}>New …</Button>
</PageActions>
```

Remove the now-duplicated button from the page header on desktop (PageActions
renders inline on phone, so the phone keeps its header button).

### 4. Dashboards / KPI rows / stacked feeds

Use responsive grids that add columns on desktop: `grid-cols-2 lg:grid-cols-4`
for KPI tiles, `lg:grid-cols-2` for two stacked feeds, etc. Never a fixed single
column on desktop for content that can sit side by side.

### 5. Density

Rely on `DataTable`'s desktop density. Don't add large desktop-only paddings.
If you tighten spacing, do it with `lg:` and keep the phone value.

## Verification gate (every change)

1. `cd apps/admin && npx tsc -b` — must be clean.
2. `npm run build` — must succeed.
3. Mobile-safety self-check: grep your diff. Every changed/added class that
   affects layout/size must be `lg:`/`xl:`/`min-[1024px]:`-prefixed, or live in
   an `isDesktop` branch, or be a brand-new element only rendered on desktop.
   If you changed an unprefixed class that a phone sees, revert it.
4. Don't touch `useMediaQuery.ts` thresholds, the `@media (max-width:768px)`
   block in `index.css`, or any `max-md:` utility.

## Tokens / canon reminders

- Never inline a hex/font/radius — use the CSS-variable tokens (canon §2.3).
- Glassmorphism on overlays/menus/drawers (`glass` / `dropglass`).
- Money via `MoneyText`; permission-aware rendering; four states per screen.

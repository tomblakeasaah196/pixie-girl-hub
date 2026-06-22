-- ============================================================
-- MIGRATION 000235 — Help Center content: attendance & clock-in
-- Pixie Girl Hub · JBS Praxis · HR attendance build
--
-- Seeds the DB-backed Help Center (shared.help_categories /
-- shared.help_articles, from 000214) with articles covering geofenced
-- clock-in, off-site flags, queries and the earnings impact — for both
-- staff (how to clock in) and HR/CEO (how to configure offices & rules).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING. Re-runs are no-ops.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('attendance', 'Attendance & Clock-In',
   'Clocking in/out, office geofences, off-site flags and how it affects pay.',
   'MapPin', 40)
ON CONFLICT (slug) DO NOTHING;

-- ── Staff: how to clock in ───────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'clock-in-basics',
  'How to clock in and out',
  'Use the clock button in the top bar; allow location when asked.',
  $md$
## Clocking in and out

Your clock control lives in the **top bar** of the app.

1. Tap **Clock in** at the start of your work day.
2. When your browser asks for **location access**, tap **Allow**. We capture your
   location *only at the moment you clock in or out* — never continuously.
3. The button turns into a live timer once you're clocked in. Tap it again to
   **clock out** at the end of the day.

### Why location?
On **on-site** days we check that you clocked in within your office's perimeter.
This protects you — your attendance is location-stamped, so there's a clear
record you were at work.

> On **remote** days, location isn't required.

If you're on an on-site day and decline location, you won't be able to clock in
until you enable it. On a phone: Settings → the browser → Location → Allow.
$md$,
  'staff', 'hr_payroll', ARRAY['attendance','clock-in','geolocation'], 1
FROM shared.help_categories c WHERE c.slug = 'attendance'
ON CONFLICT (slug) DO NOTHING;

-- ── Staff: off-site clock-in ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'offsite-clock-in',
  'What happens if I clock in off-site?',
  'Off-site clock-ins are recorded and flagged, and you''ll get a query to explain.',
  $md$
## Off-site clock-ins

If you clock in **outside your office perimeter** on an on-site day, your
clock-in is still **recorded** (we keep your exact location as evidence) but it's
**flagged for review**.

You'll receive a **query** in *My HR → Queries* asking you to explain. For
example: a client visit, a delivery run, or a GPS glitch.

- **Respond promptly.** Explain what happened.
- If HR **accepts** your explanation (waives it), your day stands normally.
- If the query is **upheld** — or you **don't respond before the deadline** —
  that day can be marked **absent**, and you lose pay for the day.

### GPS accuracy
Phones can be inaccurate indoors. If you're genuinely at the office but get
flagged, just respond to the query explaining — HR can see your coordinates and
waive it.
$md$,
  'staff', 'hr_payroll', ARRAY['attendance','off-site','queries'], 2
FROM shared.help_categories c WHERE c.slug = 'attendance'
ON CONFLICT (slug) DO NOTHING;

-- ── Staff: lateness & earnings ───────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'lateness-and-earnings',
  'Lateness, deductions and your earnings tracker',
  'See your pay build up daily; lateness deductions show immediately and can be waived.',
  $md$
## Your earnings, in real time

*My HR* shows your salary building up across the month — your monthly pay is
spread across the working days, so each day worked adds to your running total.

### Lateness
If you clock in late (past your start time + grace window), a deduction for that
day is shown **immediately** on a sliding scale your company sets (for example
1 hour = 10%, 2 hours = 20%, 3 hours = 30% of that day's pay).

Every lateness raises a **query**. Respond with your reason:
- HR **waives** it → the deduction is removed and your pay is restored.
- HR **upholds** it → the deduction stays and comes out of your net pay.
- No response before the deadline → the deduction stands.

Check *My HR → Queries* regularly so nothing lapses.
$md$,
  'staff', 'hr_payroll', ARRAY['attendance','lateness','earnings','payroll'], 3
FROM shared.help_categories c WHERE c.slug = 'attendance'
ON CONFLICT (slug) DO NOTHING;

-- ── HR/CEO: configuring offices & rules ──────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'configure-offices-geofence',
  'Setting up offices, perimeters and attendance rules',
  'Add office locations with a radius, then tune lateness and off-site rules.',
  $md$
## Configure attendance (HR & Staff → Settings)

### Offices & perimeters
1. Go to **HR & Staff → Settings → Offices & clock-in perimeters**.
2. **Add office**, name it, and place the pin on the map (or *Use my location*
   while standing at the office). Drag the **radius** to set the perimeter.
3. Save. Add as many offices as you have locations.

**Radius advice:** GPS drifts 20–100 m indoors. Use **100–200 m** to avoid
false off-site flags. A too-tight radius will reject staff who are actually
there.

### Rules (Settings → Geofenced clock-in)
- **Enforce office geofence** — master switch.
- **Require location to clock in (on-site days)** — blocks clock-in without a
  location fix on on-site days.
- **Auto-raise a query for off-site clock-ins** — recommended on.
- **Mark absent if an off-site query is upheld or lapses** — the penalty.
- **Max GPS accuracy to trust** — flag (not auto-reject) coarser fixes.

### Daily reconcile
Use **Reconcile today** on the Attendance tab to compute presence, lateness and
off-site flags, and to raise the day's queries. **Apply lapsed off-site
penalties** marks unanswered off-site days absent after their deadline.

> The geofence tells you *where*; the **query + your review** is what makes it
> fair. Location data is spoofable, so treat flags as prompts to review, not
> automatic proof. Capture is point-in-time only and disclosed to staff.
$md$,
  'ceo', 'hr_payroll', ARRAY['attendance','geofence','settings','admin'], 4
FROM shared.help_categories c WHERE c.slug = 'attendance'
ON CONFLICT (slug) DO NOTHING;

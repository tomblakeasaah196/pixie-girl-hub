# CEO Onboarding — Training Deck

A 10-slide, 16:9 hands-on onboarding deck for the CEO of both businesses
(Pixie Girl Global + Faitlyn Hair). Designed for a ~60-minute session:
concise, practice on every content slide, no screenshots. Maroon Noir brand
palette, Playfair Display / Montserrat / JetBrains Mono.

## Deliverable

- **`Pixie-Girl-Hub-CEO-Onboarding.pdf`** — the deck to present / download
  (10 pages, 13.333 × 7.5 in).

## Slides

1. Cover — Command of the Hub
2. The big picture — one system, both businesses
3. The first habit — switch business (top-left)
4. Getting around — sidebar groups + ⌘K command palette
5. Your Command Center — home + `/dashboard`
6. Praxis — your AI chief of staff
7. Approvals & workflow — what lands on your desk
8. Follow the money — Invoicing / Accounting / Expenses
9. People, access & control — Org & Workflow / IAM / HR / AI Control
10. Your daily 10 minutes + cheat sheet

## Source & regeneration

- `deck.html` — the deck (self-contained layout; links `fonts.css`).
- `fonts.css` — brand fonts embedded as base64 (rendering is deterministic
  offline). Regenerate with `python3 fetch_fonts.py`.
- `render.mjs` — HTML → PDF via `puppeteer-core` + local Chromium.

```bash
# from this folder
npm i puppeteer-core          # once
python3 fetch_fonts.py        # only if refreshing fonts.css
node render.mjs               # writes the PDF (set CHROME=/path/to/chrome if needed)
```

To edit content or styling, change `deck.html` and re-run `render.mjs`.

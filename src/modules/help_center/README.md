# Help Center

DB-driven guides and FAQs surfaced through `/help` in the admin app and
through Praxis (mirrored into `ai_knowledge_chunks` so the agent can
ground answers in the same body the user reads).

**Spec:** Pixie Girl Hub V2.2 §6.30 (Help Center).
**Permission key:** `help_center`

## Why it exists

The CEO needs a place to read "why can't my staff start a WhatsApp
chat" and similar engineering decisions in plain English. Staff need
contextual help next to features they're using. Praxis needs grounded
sources for cost-strategy questions. One table satisfies all three.

## Backing tables

- `shared.help_categories`
- `shared.help_articles`
- `shared.ai_knowledge_chunks` (mirrored from help_articles by the
  seed in migration 000214 and going forward by the upsert path
  once we add the editor).

## Files

| File                        | Purpose                 |
| --------------------------- | ----------------------- |
| `help-center.routes.js`     | Express router          |
| `help-center.controller.js` | HTTP handlers           |
| `help-center.service.js`    | List + get + view-count |
| `help-center.repo.js`       | Parameterised SQL       |

## Endpoints

| Method | Path                                         |
| ------ | -------------------------------------------- |
| GET    | `/api/v1/help/categories`                    |
| GET    | `/api/v1/help/articles?module=&category=&q=` |
| GET    | `/api/v1/help/articles/:slug`                |

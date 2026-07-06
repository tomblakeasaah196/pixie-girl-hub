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
- `shared.ai_knowledge_chunks` — mirrored from help_articles. Seeded in
  bulk by the `*_shared_help_praxis_mirror*` migrations, and kept in step
  **live** by the editor: every article create/update/retire calls
  `repo.resyncArticleChunk`, which delete-then-inserts the chunk for
  `help_article:<slug>`. A retired or de-indexed article leaves no chunk,
  so Praxis stops citing it immediately.

## Files

| File                        | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `help-center.routes.js`     | Express router (read + editor)           |
| `help-center.controller.js` | HTTP handlers                            |
| `help-center.service.js`    | List/get/view-count + editor + AI resync |
| `help-center.repo.js`       | Parameterised SQL + chunk resync         |
| `help-center.validator.js`  | Zod schemas for the editor writes        |

## Endpoints

Read (`help_center:view`):

| Method | Path                                         |
| ------ | -------------------------------------------- |
| GET    | `/api/v1/help/categories`                    |
| GET    | `/api/v1/help/articles?module=&category=&q=` |
| GET    | `/api/v1/help/articles/:slug`                |

Editor (in-app Help Editor at `/help/editor`):

| Method | Path                             | Permission          |
| ------ | -------------------------------- | ------------------- |
| GET    | `/api/v1/help/admin/articles`    | `help_center:edit`  |
| GET    | `/api/v1/help/admin/articles/:id`| `help_center:edit`  |
| GET    | `/api/v1/help/admin/categories`  | `help_center:edit`  |
| POST   | `/api/v1/help/articles`          | `help_center:create`|
| PATCH  | `/api/v1/help/articles/:id`      | `help_center:edit`  |
| DELETE | `/api/v1/help/articles/:id`      | `help_center:delete` (soft retire) |
| POST   | `/api/v1/help/categories`        | `help_center:create`|
| PATCH  | `/api/v1/help/categories/:id`    | `help_center:edit`  |

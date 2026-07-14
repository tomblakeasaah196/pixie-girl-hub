# SocialMedia module ("Social Studio" in the admin UI)

**Spec:** Social Media Management (V2.2 §6.14)
**Permission key:** `social`

Manual-first, proof-of-publish: a creator plans a whole month of posts as one
"content plan", submits it as a single CEO approval (workflow engine), then
posts natively from their own device and proves it here with a link
(verified server-side via oEmbed — no OAuth, no Graph API publishing) plus a
screenshot. A missed deadline nudges the creator, then escalates straight to
the CEO — flat, two-tier, no team-lead stage.

## Backing tables (all `shared`)

- `social_accounts` — handle registry (no OAuth tokens; nothing here publishes)
- `social_content_plans` — the monthly batch, workflow-gated
- `social_posts` — status: `draft → assigned/scheduled → posted | flagged → archived`
- `social_post_metrics` — manually entered / best-effort scraped engagement
- `social_targets` — CEO-set monthly post targets, per platform and optionally per creator

## Files

| File                   | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `social.routes.js`     | Express router — URL → controller                                   |
| `social.controller.js` | HTTP handlers (req/res only)                                        |
| `social.service.js`    | Business logic, workflow integration, deadline sweep, scoring reads |
| `social.repo.js`       | Parameterised SQL only                                              |
| `social.validator.js`  | Zod input schemas                                                   |
| `social.events.js`     | Domain events for realtime + AI                                     |
| `social.scoring.js`    | Pure Post Grade formula (timeliness + engagement)                   |
| `social.deadlines.js`  | Pure nudge/escalate policy + quiet-hours window                     |

Related, outside this directory:

- `src/services/social-proof.service.js` — oEmbed lookup for a pasted proof link
- `src/jobs/schedulers/social-deadline-sweep.js` — hourly cron adapter for the deadline sweep
- `src/workflows/default-definitions.js` (`social:submit_plan`) — the CEO approval route for a content plan

## Design notes

- **No publish API.** `social-publisher.service.js` (Meta/TikTok/YouTube Graph
  API publishing) was removed — it was permanently blocked on Meta App
  Review. Proof of publish replaces it entirely; the module never calls out
  to publish anything.
- **Post Grade is two numbers, never blended:** `performance_score` (0-100,
  formula-driven from `social.scoring.js`) and `creative_rating` (1-5,
  a manager's subjective star rating).
- **Accountability is flat:** `social.deadlines.js` decides nudge vs.
  escalate; escalation reports straight to the CEO, no team-lead tier.
- **Targets are report-only.** `social_targets` drives the attainment %
  shown on the Performance/Team tabs — it has no automatic link to payroll or
  appraisal; any pay impact is a manual call made outside this module.

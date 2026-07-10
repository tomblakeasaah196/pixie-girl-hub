# User Accounts & Access Audit — duplicate logins / "granted a role but sees nothing"

**Date:** 2026-07-10 · **Trigger:** a role was granted to a staff member
(Operations Manager, Faitlyn Hair) yet their session received 403s on every
module API (`/insights/modules`, `/tasks/board`, `/calendar`), and the same
person appeared twice in IAM → Users & Access.

## Symptom chain, fully explained

1. **The person has (or appears to have) two login accounts.** Nothing in the
   schema or services enforced *one login per staff profile*:
   `shared.users.staff_profile_id` is a plain FK (migration 000003) with no
   uniqueness, and none of the three account-creation paths (IAM provision,
   HR instant provision, invitation accept) checked whether the staff profile
   already had a login. Emails are CITEXT-unique, so two accounts simply need
   two different addresses (e.g. a personal gmail and an outlook address).

2. **Invitation-created logins were never linked to their staff profile.**
   `invitations.service.acceptInvitation` built the user without passing
   `staff_profile_id`, even though the invite carried it and the repo INSERT
   supported it. Result: the account the person actually signs in with is
   orphaned from HR.

3. **Org & Workflow position grants go to "the" linked login.** A position's
   `GRANTS ROLE` resolves the holder's login via
   `org.repo.userIdForProfile` — `WHERE staff_profile_id = $1 … LIMIT 1`.
   With a duplicate/orphan situation the grant silently lands on the *other*
   account (or none). This is exactly "I granted the role but it was not
   assigned to him".

4. **The Users & Access list multiplied rows per role.** `iam.repo.listUsers`
   LEFT JOINed `user_roles` × `roles`, producing one row per grant — an
   account holding `operations_manager · faitlynhair` **and**
   `operations_manager · All businesses` rendered as two identical rows. The
   admin cannot tell duplicates from join fan-out, and the roles drawer
   opened from the "wrong" row targets whatever account that row is.

5. **The nav was broken for every non-CEO anyway.**
   `GET /auth/me/permissions` destructured `{ rows }` from a repo function
   that returns a plain array — the response was always `{ data: undefined }`
   for non-CEO users, the frontend's `grants.some(...)` threw, and the store
   fell back to zero permissions. Every non-CEO user saw only the ungated
   shell (Dashboard, Workspace, "More · 1") regardless of their real roles.
   The account that "sees everything" sees it via the CEO bypass / `'*'`
   grants, not via this endpoint.

6. **Role grants were not actually brand-scoped at runtime.** The auth
   projection collected `role_ids` from `user_roles` ignoring both the
   `business` column and `expires_at`. A role granted for one business
   conferred the same permissions under the other brand context, and expired
   grants never expired.

7. **A role granted for a business the user cannot enter is a silent no-op.**
   `grantUserRole` never touched `permitted_businesses`, and
   brand-context middleware 403s before RBAC ever consults the role.

## Fixes in this change

| # | Fix | Where |
|---|-----|-------|
| 1 | `/auth/me/permissions` returns the grant list again (`{rows}` → array) | `src/shared/hr_payroll/auth.controller.js` |
| 2 | Invitation accept links the login to its staff profile | `src/shared/hr_payroll/invitations.service.js` |
| 3 | All three provisioning paths refuse a second login for a linked profile (409) | `iam.service.js`, `invitations.service.js` |
| 4 | DB trigger blocks *new* duplicate links (existing rows stay serviceable) | `migrations/000316_shared_one_login_per_staff_profile.sql` |
| 5 | Users & Access lists one row per user with **all** roles aggregated | `iam.repo.js` (+ `IamUsersPage.tsx`, `lib/iam.ts`) |
| 6 | RBAC honours the grant's business (`'*'` = all) and `expires_at` | `staff.repo.js`, `identity-cache.js`, `middleware/auth.js`, `middleware/rbac.js` |
| 7 | Granting a role for a concrete business extends `permitted_businesses` | `src/shared/access/access.service.js` |
| 8 | Read-only audit tool with remediation SQL | `scripts/audit-user-accounts.js` (`npm run audit:users`) |

## Operational runbook (fix the live data)

1. Deploy this branch (run migrations — 000316 is idempotent).
2. `npm run audit:users` against production. It reports: duplicate logins per
   staff profile, invite-orphaned logins, invisible grants, expired grants,
   role-less active users, same-name accounts, and CEO/`'*'` review list —
   each with suggested SQL. **It never modifies data.**
3. For each duplicated person: keep the account they actually sign in with,
   move its role grants (`UPDATE shared.user_roles SET user_id = …`), link
   the staff profile to the kept account, disable the duplicate.
4. Have affected users sign out/in (or wait 30 s for the identity cache TTL).

## Still open (follow-ups, not in this change)

- `req.user.role_ids` remains brand-*unscoped* for consumers other than
  `requirePermission` (workflow approvals, search, Praxis AI, dashboards
  access, socket auth). They should adopt the same `role_grants` filter.
- `org.repo.userIdForProfile` / `hr.repo.LIST_SELECT` still pick "oldest
  active login" when legacy duplicates exist; harmless once data is merged
  and the trigger prevents recurrence.
- Consider replacing the 000316 trigger with a real partial UNIQUE index once
  production data is clean.

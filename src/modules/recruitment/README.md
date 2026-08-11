# Recruitment module

Hiring, end to end. Two surfaces, one permission module (`recruitment`):

- **HR & Staff → Vacancies** (vacancy-first) — post a role, AI drafts the whole
  vacancy from a conversational intake, publish it to the public Careers page,
  and track applicants through a pipeline with an AI match score + the
  5-question rubric. See `recruitment.vacancy.*` and the "Vacancy flow" below.
- **HR & Staff → Recruitment** (offer-first) — AI drafts a Job Description +
  Offer Letter, an admin edits them in the Offer Studio, the candidate signs a
  no-login offer packet, and the employment contract is generated on signature.
  A login is **not** created automatically — an admin later provisions it and
  the one-time password is emailed straight to the new hire.

A **Vacancies** applicant moved to "Offered" spawns a `recruitment_offer`
pre-filled from the vacancy + application, and the Offer Studio takes over — so
the two surfaces are one continuous funnel.

## Vacancy flow (000377_shared_job_vacancies)

```
New vacancy → conversational intake (scripted spine + AI follow-ups, voice via
  Groq Whisper) → recruitment.vacancy.ai.draftVacancy (Gemini → DeepSeek →
  template) writes JD + requirements + work model + salary band
   → review & Publish                              POST /vacancies, /vacancies/:id/status
   → public Careers page + application form (PR 2)  POST /api/public/careers/... (follow-up PR)
   → applicants tracked                             GET  /vacancies/:id/applications
        · AI match score (Gemini vision: CV image/pdf + work images vs JD+rubric)
        · per-user star ratings, internal notes, pipeline stages
   → 5 strategic questions (the rubric)             POST /vacancies/:id/questions/generate
        · hiring manager answers → re-score all      PUT  /vacancies/:id/questions
   → Move to Offered                                POST /applications/:appId/offer
        · spawns a recruitment_offer → Offer Studio
```

Files: `recruitment.vacancy.{repo,ai,service,controller,validator}.js`; routes
live in `recruitment.routes.js` under the same `/api/v1/recruitment` mount.
AI scoring is **Gemini-only** (it must read CV *images*, which DeepSeek can't),
with a deterministic heuristic fallback so a vacancy is never un-scorable.

## Flow

```
draftOffer (AI: Gemini → DeepSeek → template)     POST /offers
   → edit in the Studio                            PATCH /offers/:id
   → approveAndSend                                POST /offers/:id/send
        · renders the offer packet PDF (pdf.service)
        · opens an e-signature request (documents.esign) — candidate = signer
        · emails a short branded link to /offer/<token>
candidate opens /offer/<token> (no auth)          GET  /api/public/offer/:token
   → signs                                         POST /api/public/offer/:token/sign
        · documents.esign records the signature + certificate
        · onOfferSigned → generates + countersigns the contract PDF
        · welcome email: "login details to follow"
admin provisions the login (explicit)             POST /offers/:id/provision
        · reuses hr_payroll invitations.provisionLogin (temp password)
        · emails the credentials straight to the candidate
        · body (optional, from the onboarding wizard):
            staff_profile_id — links the login to the HR employee profile so
              the hire shows in the directory + organigramme seat, and the
              generated contract PDF is filed under their HR contracts
            role_ids — replaces the offer's stored grants (e.g. the seated
              position's role)
```

The admin UI drives provisioning through the staff-onboarding wizard
(`/contacts/staff/new?offer_id=…`), prefilled from the offer: it creates the
contact + HR employee profile, seats the hire in an organigramme position
(creating the department/position inline if needed), then calls
`/offers/:id/provision` with the new `staff_profile_id`.

## Files

| File | Role |
|------|------|
| `recruitment.routes.js` | admin + public routers; loads subscribers |
| `recruitment.controller.js` | thin HTTP handlers |
| `recruitment.service.js` | orchestration, transactions, events, audit |
| `recruitment.repo.js` | parameterised SQL (shared schema) |
| `recruitment.ai.js` | drafting: Gemini primary, DeepSeek fallback, template fallback |
| `recruitment.render.js` | safe markdown→HTML + offer packet / contract PDF bodies |
| `recruitment.validator.js` | Zod input schemas |
| `recruitment.events.js` | domain events |
| `recruitment.subscribers.js` | `documents.signature.fully_signed` → contract + welcome |

## Reuse (this module is mostly assembly)

- **E-signature**: `shared/documents/documents.esign.*` (token signing, audit chain, certificate, `/verify/<code>`).
- **PDF**: `services/pdf.service` (`renderAndStore`) + the shared print shell.
- **Login provisioning**: `shared/hr_payroll/invitations.provisionLogin`.
- **LLM**: `services/gemini.service` + `services/llm.service` (keys from AI Control).

## Data (migration `000318_shared_recruitment.sql`, all in `shared`)

`recruitment_context` (editable AI grounding, seeded per brand), `role_templates`,
`job_openings`, `candidates`, `recruitment_offers` (the core — holds the editable
JD/offer markdown, structured `offer_meta`, the public token, and links to the
offer + contract documents and the e-sign request).

## Not in scope (future PRs)

- Praxis conversational drafting action (drafting logic already lives in
  `recruitment.ai.draft`, provider-agnostic, ready to wrap).
- Collaborative multi-user editing (the Studio preview is client-side realtime).
- Full applicant pipeline (screening / interviews / scorecards).

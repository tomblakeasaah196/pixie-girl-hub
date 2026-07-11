# Recruitment module

Hiring, end to end — surfaced in the admin as **HR & Staff → Recruitment**.

AI drafts a Job Description + Offer Letter, an admin edits them in the Offer
Studio, the candidate signs a no-login offer packet, and the employment
contract is generated on signature. A login is **not** created automatically —
an admin later provisions it and the one-time password is emailed straight to
the new hire.

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
```

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

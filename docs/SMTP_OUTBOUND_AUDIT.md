# SMTP / Outbound Email Audit

> **⚠ Domain migration (2026-07-16):** Faitlyn's domain moved from
> `thefaitlynbrand.com` to **`faitlynhair.com`** and the old domain's DNS
> was retired. References to `thefaitlynbrand.com` in the *evidence*
> sections below are historical (they describe the DNS state on
> 2026-07-07). The *action* sections (§5) have been updated to the new
> domain. Sender identity is now configured per brand in **Messaging →
> Settings → Outbound Email** (DB-backed), which takes precedence over
> the `SMTP_*` env vars shown here.

**Date:** 2026-07-07
**Scope:** Every outbound email path in the ERP — transactional, campaigns, e-signature, auth.
**Trigger:** "Send for signature" from the Documents module produced no email, raising the question of whether customers have been receiving mail at all.
**Status:** Code faults fixed in this branch. **Delivery is not restored until the environment + DNS actions below are done** (owner: infra/DevOps).

---

## 1. Verdict

Outbound email was **unreliable and partly invisible**, from three independent faults:

1. **The e-signature "send" never sent an email.** Not a delivery problem — the code simply never called the mailer on send.
2. **The SMTP relay is a dev placeholder (`localhost:25`, no auth).** A local mail server on the VPS *accepts* messages (so the app logs them "sent"), but "sent" only means "the local server took it," **not** "the customer received it." Onward delivery to Gmail/Yahoo depends on SPF/DKIM/DMARC, which are misaligned for one of the two brands.
3. **Failures were swallowed silently.** Most transactional sends are fire-and-forget with the error discarded, and there was no startup check and no live verification — so a broken relay could (and did) go unnoticed.

Net effect: `pixiegirlglobal.com` mail probably mostly lands (possibly in spam); `thefaitlynbrand.com` mail likely fails SPF and lands in spam or is rejected; e-signature requests sent nothing at all.

---

## 2. Evidence

### 2.1 `shared.outbound_comms_log` (live, 2026-07-07)

```
 status | channel |       event_key       | count
 queued | email   | invoice.sent          |   3
 sent   | email   | invoice.sent          |   3
 sent   | email   | smartcomm.email_reply |   1
```

- `sent` rows, **zero `failed`** → the transport is accepting mail (a local MTA exists on the box). It is *not* a total blackout.
- **`sent` ≠ delivered.** The processor writes `sent` when the *local relay* accepts the handoff; downstream bounces/spam are invisible here.
- Only the **queue path** (invoices, receipts, smartcomm) is logged here. Welcome, password-reset, email-verify, and **e-signature** emails are inline and **were not logged anywhere** — so their failures left no trace.

### 2.2 Sending-domain DNS (live lookups)

| Domain | Role | MX | SPF | DMARC | Verdict |
|---|---|---|---|---|---|
| `pixiegirlglobal.com` | Pixie `noreply@` from-address | Hostinger + Cloudflare | `v=spf1 ip4:173.208.151.105 include:_spf.mx.cloudflare.net ~all` | `p=none`, rua→`noreply@` (unread) | SPF authorizes the VPS IP but **not Hostinger**; no DKIM from the local relay |
| `thefaitlynbrand.com` | Faitlyn `noreply@` from-address | Hostinger | `v=spf1 include:_spf.mail.hostinger.com ~all` | `p=none` | SPF authorizes **Hostinger only** — mail from the local VPS relay **fails SPF** |
| `faitlynhair.com` | Storefront `hello@` support | **none** | `v=spf1 ip4:173.208.151.105 ~all` | missing | **No MX — `hello@faitlynhair.com` cannot receive mail; replies bounce** |

Key implication: the app sends from a local relay (VPS IP `173.208.151.105`). That IP passes SPF for `pixiegirlglobal.com` but **not** for `thefaitlynbrand.com` → inconsistent inbox placement between the two brands.

---

## 3. Root causes (code)

| # | Fault | Location |
|---|---|---|
| 1 | `sendRequest()` set status to `sent` + wrote audit events but **never emailed the signing link**. The only e-sign emails were the 48h *reminder* cron and the *expiry* notice. | `src/shared/documents/documents.esign.service.js` |
| 2 | Default transport hardcoded `ignoreTLS: true`, **disabling STARTTLS** — fine for loopback plaintext, but a real relay on 587 would be rejected or sent credentials in the clear. | `src/services/email.service.js` |
| 3 | No boot-time config check and no live `verify()` anywhere — nothing ever proved mail could leave the box. | (absent) |
| 4 | `sendVerifyEmail` / `forgotPassword` swallowed send errors with a bare `catch {}` — a broken relay meant no customer could verify or reset, silently. | `src/modules/customer_auth/customer-auth.service.js` |
| 5 | `check-integrations` marked SMTP green on env-presence only (and did no network test), so a placeholder relay looked fine. | `scripts/check-integrations.js` |

---

## 4. What this branch fixes

| Change | Effect | File |
|---|---|---|
| **E-sign now emails the signing link on send** | Each freshly-activated signer is emailed their link via the durable `email-send` queue (retried, auto-logged to `outbound_comms_log`). Post-commit + non-fatal. | `documents.esign.service.js` |
| **TLS-correct transport** + new `SMTP_SECURE` | Loopback → plaintext (unchanged); port 465 / `SMTP_SECURE=true` → implicit TLS; otherwise **STARTTLS required**. Makes a real relay actually work. Backward-compatible with the current `localhost:25`. | `email.service.js`, `config/env.js` |
| **Boot-time SMTP sanity warning** | Logs loudly in staging/prod when the relay is placeholder-shaped (localhost / port 25 / no auth). Mirrors `gemini.checkConfigAtBoot()`. | `email.service.js`, `server.js` |
| **Failures made visible** | Verify + password-reset send failures are logged (reset response stays uniform to avoid account enumeration). | `customer-auth.service.js` |
| **`npm run smtp:doctor`** | Live diagnostic: dumps config, checks MX/SPF/DMARC, runs a real `verify()`, and (with `--to`) sends a real test email. | `scripts/smtp-doctor.js` |
| **Honest integration check** | SMTP line flags localhost/port-25/no-auth as a warning and points at `smtp:doctor`. | `scripts/check-integrations.js` |

> **Important:** deploying this branch ships the *code* fixes. It does **not** by itself fix delivery — the relay is still `localhost:25` until the `.env` + DNS actions in §5 are done. After the code deploys, e-sign emails will start flowing through the *same* local relay as invoices (an improvement over sending nothing), but true inbox delivery still needs §5.

---

## 5. Remaining actions (owner: infra/DevOps) — required for real delivery

These cannot be done in code. You already have **Hostinger** email hosting; use it.

### 5.1 Point SMTP at Hostinger's authenticated relay (live `.env`)

Per-brand blocks so each brand authenticates as its own domain (the code supports `SMTP_<BRAND>_*`):

```bash
# Pixie (global default)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@pixiegirlglobal.com
SMTP_PASSWORD=<mailbox password>
SMTP_FROM_EMAIL=noreply@pixiegirlglobal.com
SMTP_FROM_NAME=Pixie Girl Hub

# Faitlyn (its own mailbox → passes SPF/DKIM as faitlynhair.com)
SMTP_FAITLYNHAIR_HOST=smtp.hostinger.com
SMTP_FAITLYNHAIR_PORT=465
SMTP_FAITLYNHAIR_SECURE=true
SMTP_FAITLYNHAIR_USER=noreply@faitlynhair.com
SMTP_FAITLYNHAIR_PASSWORD=<mailbox password>
```

Then restart the app + worker (`pm2 reload pixie-girl-hub`).

### 5.2 Fix DNS

- **`pixiegirlglobal.com` SPF** — add Hostinger:
  `v=spf1 ip4:173.208.151.105 include:_spf.mx.cloudflare.net include:_spf.mail.hostinger.com ~all`
- **Enable DKIM** for both `pixiegirlglobal.com` and `faitlynhair.com` in Hostinger (hPanel → Emails → DKIM) and add the published records.
- **`faitlynhair.com` MX** — it is now the brand's only mail domain, so it MUST have Hostinger MX records and mailboxes for every advertised address (support@, sales@, noreply@). Without MX, every reply bounces.
- **DMARC** — leave at `p=none` until SPF+DKIM are confirmed, then tighten to `p=quarantine`. Point the pixie `rua` at a *monitored* mailbox (not `noreply@`).

### 5.3 Verify end-to-end (on the VPS, after 5.1)

```bash
npm run smtp:doctor -- --to your-personal@gmail.com
```

It connects, sends a real email, and reports the true result. **Then check Inbox vs Spam** — Spam means DKIM/SPF (§5.2) still need attention. Re-run per brand by setting `SMTP_FROM_EMAIL` to each brand's from-address.

---

## 6. How to confirm current damage / recovery

```sql
-- Everything logged (queue path only): invoices, receipts, smartcomm replies
SELECT status, channel, event_key, count(*), max(created_at)
FROM shared.outbound_comms_log
GROUP BY 1,2,3 ORDER BY 4 DESC;

-- After the fix, e-signature sends will start appearing here:
SELECT * FROM shared.outbound_comms_log
WHERE event_key = 'signature.request_sent'
ORDER BY created_at DESC LIMIT 20;
```

Also inspect the local relay directly on the VPS: `mailq` and `/var/log/mail.log` show whether the local MTA is delivering onward or backing up.

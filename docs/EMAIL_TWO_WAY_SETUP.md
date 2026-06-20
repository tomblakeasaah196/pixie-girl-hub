# Two-Way Email Setup — Engineer Runbook

**Audience:** the engineer setting up email/DNS for both brands.
**Goal:** make email a *two-way conversation channel* inside Pixie Girl Hub. A customer
emails `sales@<brand>`, it appears as an inbound message in the right conversation; a rep
replies in-app, the customer receives it, and the customer's reply threads back to the same
conversation.

**The two brands (different hosts — this is the whole reason this note exists):**

| Brand | Domain | DNS host today | Website host |
|---|---|---|---|
| Pixie Girl Global | `pixiegirlglobal.com` | Cloudflare | (unchanged) |
| Faitlynhair | `faitlynhair.com` | **Hostinger** | **Hostinger** |

**Decisions already made (build to these, don't redesign):**
- **Inbound, both brands → Cloudflare Email Routing → Email Worker → our webhook.** Pixie is
  already on Cloudflare. Faitlyn must move **nameservers to Cloudflare for email**, while the
  **website stays on Hostinger** (we re-create the existing A/CNAME records in Cloudflare DNS
  so the site is unaffected).
- **Outbound, per-brand SMTP.** Pixie sends via its existing transactional SMTP relay.
  Faitlyn sends via **Hostinger SMTP** (`smtp.hostinger.com`).
- **Always set `Reply-To: sales@<brand>`** on every outbound email — even transactional mail
  whose `From:` is `noreply@`. `noreply@` mailboxes never receive, so the `Reply-To` is what
  makes a customer's reply land on a monitored address that our webhook ingests.

---

## What the app ALREADY provides (no work needed here — this is the contract)

- **Inbound webhook (live):** `POST https://<API_HOST>/api/webhooks/email/inbound`
  - **Auth:** HMAC-SHA256 over the **raw** request body, sent in header
    `x-cf-email-signature: sha256=<hex>`, keyed with the shared secret `CF_EMAIL_INBOUND_SECRET`.
  - **Body (JSON):**
    ```json
    {
      "to":         "sales@faitlynhair.com",
      "from":       "customer@gmail.com",
      "subject":    "Re: Your order FH-1234",
      "text":       "plain-text body",
      "html":       "<p>optional html body</p>",
      "message_id": "<the email Message-ID>",
      "in_reply_to":"<Message-ID this is replying to>",
      "thread_id":  "optional explicit thread id"
    }
    ```
  - **Brand routing:** the app resolves which brand owns the message from the **`to`** address,
    via a **Messaging Accounts** row (see step 4). If no row maps `to → brand`, the message is
    dropped — so the Messaging Accounts rows are mandatory.
  - **Threading:** the app threads on `thread_id || in_reply_to || message_id`. So the Worker
    must pass through the original `Message-ID` / `In-Reply-To` headers.
- **Outbound (live):** Nodemailer over SMTP. (App-side change in progress: per-brand SMTP
  selection + `Reply-To`. You just provide the two credential sets + DNS below.)

---

## Step 1 — Faitlyn: move nameservers to Cloudflare (email-only, website stays on Hostinger)

1. In Cloudflare, **Add a site** → `faitlynhair.com`. Choose the Free plan.
2. Cloudflare will scan existing DNS. **Verify every website record is preserved** — the
   `A`/`AAAA`/`CNAME` records that point the site at Hostinger must be re-created exactly
   (Hostinger gives you these in hPanel → DNS Zone). The website must keep resolving to
   Hostinger after the switch. Set those web records to **DNS-only (grey cloud)** unless you
   intend to proxy.
3. At the **registrar**, change the nameservers to the two Cloudflare nameservers Cloudflare
   shows you. Wait for Cloudflare to report the domain **Active** (minutes to a few hours).
4. ✅ Outcome: Faitlyn's DNS is now managed in Cloudflare; the website is still served by
   Hostinger. Only email routing changes.

> Pixie (`pixiegirlglobal.com`) is already on Cloudflare — skip this step for Pixie.

---

## Step 2 — Enable Cloudflare Email Routing + deploy the Email Worker (BOTH brands)

Do this for **`pixiegirlglobal.com`** and **`faitlynhair.com`**.

1. Cloudflare dashboard → domain → **Email → Email Routing → Enable**. Accept the **MX + SPF**
   records Cloudflare adds automatically.
2. Create the destination address / Worker:
   - Create an **Email Worker** (sample in the appendix) that:
     - reads the raw message,
     - computes `HMAC-SHA256(rawBody, CF_EMAIL_INBOUND_SECRET)`,
     - `POST`s the JSON contract above to `https://<API_HOST>/api/webhooks/email/inbound`
       with header `x-cf-email-signature: sha256=<hex>`.
   - Route **`sales@<brand>`** (and ideally a catch-all `*@<brand>` or `sales+*@<brand>` for
     subaddressed threading) to that Worker.
3. Set the secret in the Worker (Settings → Variables): `CF_EMAIL_INBOUND_SECRET = <shared
   random string>`. **Use the same value for both brands** and hand it to the app team for the
   server `.env`.

> Note for Faitlyn: because inbound MX now points at Cloudflare, mail for `sales@faitlynhair.com`
> is consumed by the Worker → our app. The Hostinger mailbox (Step 3) is used **only for
> sending**; it will not receive customer mail, and that's intentional — the app is the inbox.

---

## Step 3 — Outbound SMTP (per brand) + the Reply-To rule

### Pixie Girl Global — existing relay
- Keep using the current transactional SMTP provider (whatever `SMTP_HOST` is configured to).
- Ensure the sending domain `pixiegirlglobal.com` is verified there with **DKIM** published.

### Faitlynhair — Hostinger SMTP
1. In Hostinger hPanel → **Emails**, create the mailbox **`sales@faitlynhair.com`** and set a
   strong password.
2. Note the SMTP submission settings (typically):
   - Host: `smtp.hostinger.com`
   - Port: `465` (SSL) or `587` (STARTTLS)
   - User: `sales@faitlynhair.com`
   - Pass: the mailbox password
3. Hand these credentials to the app team (they go in per-brand server `.env`, never in the repo).

### Reply-To rule (applies to BOTH brands, all outbound)
- Transactional mail (receipts, invoices, OTP): `From: noreply@<brand>`, **`Reply-To: sales@<brand>`**.
- Conversational channel mail (a rep's reply inside a chat thread): `From: sales@<brand>`,
  **`Reply-To: sales@<brand>`**.
- Either way the customer's reply goes to `sales@<brand>` → Cloudflare → Worker → our webhook →
  threads back into the conversation.

---

## Step 4 — Messaging Accounts mapping (inbound brand routing)

The app routes inbound by the **`to`** address. Add one row per brand (CEO can do this in the
admin at **Settings → Messaging Accounts**, or seed in DB):

| Platform | External account id (`to`) | Brand |
|---|---|---|
| email | `sales@pixiegirlglobal.com` | `pixiegirl` |
| email | `sales@faitlynhair.com` | `faitlynhair` |

Without these rows the webhook **drops** inbound email.

---

## Step 5 — DNS records to publish (in Cloudflare DNS for BOTH domains)

| Record | Pixie (`pixiegirlglobal.com`) | Faitlyn (`faitlynhair.com`) |
|---|---|---|
| **MX** | Cloudflare Email Routing (auto) | Cloudflare Email Routing (auto) |
| **SPF (TXT)** | `v=spf1 include:<existing-relay-spf> ~all` | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| **DKIM** | the existing relay's DKIM record | Hostinger's DKIM record (hPanel shows it) |
| **DMARC (TXT `_dmarc`)** | `v=DMARC1; p=quarantine; rua=mailto:dmarc@pixiegirlglobal.com; fo=1` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@faitlynhair.com; fo=1` |

> SPF caution: a domain may publish **only one** SPF TXT record. If a domain both sends (relay/Hostinger)
> and uses Cloudflare Email Routing, merge the `include:` mechanisms into a single SPF record.

---

## Step 6 — Secrets to hand back to the app team (server `.env`)

- `CF_EMAIL_INBOUND_SECRET` = the shared secret used in both Workers.
- Pixie SMTP: existing relay creds (already set).
- Faitlyn SMTP: `smtp.hostinger.com`, port, `sales@faitlynhair.com`, password.
- Confirm `API_HOST` the Workers should POST to (production API origin).

---

## Acceptance test (run for BOTH brands)

1. **Inbound:** from a personal Gmail, email `sales@<brand>` → within seconds it appears as an
   inbound message on that contact's conversation in the Hub.
2. **Outbound:** reply in-app → Gmail receives it; open *Show original* → **SPF, DKIM, DMARC all PASS**.
3. **Reply-To:** confirm the received mail's `Reply-To` is `sales@<brand>` even when `From` is `noreply@`.
4. **Threading:** reply from Gmail → it lands back on the **same** conversation (not a new thread).
5. **Deliverability:** run each domain through https://www.mail-tester.com → target **≥ 9/10**.

---

## Appendix — sample Cloudflare Email Worker

```js
export default {
  async email(message, env) {
    // Build the JSON contract our webhook expects.
    const headers = message.headers;
    const rawText = await new Response(message.raw).text();

    const payload = {
      to: message.to,
      from: message.from,
      subject: headers.get("subject") || "",
      text: rawText,                 // (parse to text/plain in production if preferred)
      html: "",
      message_id: headers.get("message-id") || "",
      in_reply_to: headers.get("in-reply-to") || "",
      thread_id: "",
    };

    const body = JSON.stringify(payload);
    const sig = await hmacHex(env.CF_EMAIL_INBOUND_SECRET, body);

    await fetch(`${env.API_HOST}/api/webhooks/email/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cf-email-signature": `sha256=${sig}`,
      },
      body,
    });
  },
};

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

> The HMAC is computed over the **exact body string** that is POSTed. The app verifies the
> signature over the raw request body, so the Worker must sign the identical bytes it sends.

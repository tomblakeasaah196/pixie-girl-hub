# Nomba Webhook Signature Key — Setup Instructions
## (Paste this into the Nomba dashboard)

---

## What this is

Nomba signs every outgoing webhook with an **HMAC-SHA256** signature.
The signature is built from a **canonical string of payload fields** (NOT the raw body)
and keyed on a secret **you choose yourself** in the Nomba dashboard.

Your backend must know this same secret to verify incoming webhooks.

---

## Step 1 — Generate the secret

Run this command on your server (or any trusted machine):

```bash
openssl rand -hex 32
```

This produces a 64-character hex string, e.g.:

```
a3f8b2c9e4d1a7f0b5c8e2d6a9f3b1c7e4d0a8b2f5c9e1d3a7b0f5c8e2d6a9
```

**Copy this string.** You will paste it into two places.

---

## Step 2 — Paste into Nomba dashboard

1. Log into the Nomba dashboard
2. Navigate to **Developer → Webhook Setup**
3. In the **"Signature Key"** field, paste the exact 64-char hex string from Step 1
4. Set your webhook URL to:
   ```
   https://hub.pixiegirlglobal.com/api/webhooks/nomba
   ```
5. Subscribe to these event types (tick the boxes):
   - ✅ `payment_success`
   - ✅ `payment_failed`
   - ✅ `payout_success`
   - ✅ `payout_failed`
   - ✅ `payment_reversal`
6. Click **Save**

---

## Step 3 — Add to your backend env vars

In your production env file (and per-brand overrides if applicable):

```bash
# .env (production)

# Nomba API credentials (used for outbound calls)
NOMBA_CLIENT_ID=<your-client-id>
NOMBA_API_KEY=<your-client-secret>
NOMBA_ACCOUNT_ID=<your-account-id>

# Nomba webhook signature key (used to VERIFY inbound webhooks)
# ← PASTE THE EXACT SAME 64-char string from Step 1 here:
NOMBA_WEBHOOK_SIG_KEY=a3f8b2c9e4d1a7f0b5c8e2d6a9f3b1c7e4d0a8b2f5c9e1d3a7b0f5c8e2d6a9
```

### Per-brand override (if you have >1 Nomba account)

```bash
PIXIE_NOMBA_WEBHOOK_SIG_KEY=<pixie-brand-key>
FAITLYN_NOMBA_WEBHOOK_SIG_KEY=<faitlyn-brand-key>
```

These per-brand keys are also set in the Nomba dashboard under each account's
**Developer → Webhook Setup** page.

---

## Step 4 — Verify it works

After deploying the fixed code and setting the env var:

### 4a. Check the `webhook_log` table

```sql
SELECT id, source, event_type, signature_valid, created_at
FROM shared.webhook_log
WHERE source = 'nomba'
ORDER BY created_at DESC
LIMIT 10;
```

- `signature_valid = true`  → ✅ working
- `signature_valid = false` → ❌ secret mismatch (check env var)
- No rows at all                   → ❌ route not hitting (check deployed code)

### 4b. Use Nomba's dashboard to repush a test event

1. Nomba dashboard → **Developer → Webhook Repush**
2. Find a recent `payment_success` event
3. Click **Repush**
4. Watch your server logs for:
   ```
   gateway charge confirmed via webhook
   ```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `signature_valid = false` in `webhook_log` | `NOMBA_WEBHOOK_SIG_KEY` doesn't match the dashboard key | Re-copy the key exactly (no trailing spaces) |
| `webhook rejected: invalid signature` in logs | Same as above | Same as above |
| No rows in `webhook_log` for `nomba` | Route not deployed / `\n` still in path | Deploy the fixed `webhooks.routes.js` |
| Nomba dashboard says "URL validation failed" | GET probe returns non-200 | Make sure `router.get("/nomba", …)` is deployed (no `\n`) |
| Events show as "PUSHED" in Nomba dashboard but nothing in your DB | `signature_valid = false` → webhook dropped after 401 | Fix the signature key |

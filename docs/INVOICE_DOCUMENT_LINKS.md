# Customer invoice & receipt links (`/api/public/documents/...`)

## Why this exists

The invoice link emailed/DM'd to customers used to be
`<APP_URL>/api/public/invoices/<brand>/<id>/view`, which answered **raw JSON**.
On a phone that is what the customer sees — a wall of `{"data":{…}}` — which is
exactly the "your invoice link is corrupted" report that started this work
(FLH-INV-0159). Nothing rendered that JSON: no storefront route, no SPA route.

The customer-facing link now serves the **branded PDF** the business already
generates for every invoice, and opening it stamps the same first-view signal
the JSON view used to.

## The URL surface

| URL | Behaviour |
| --- | --- |
| `GET /api/public/documents/invoice/:id` | **Canonical.** Serves the invoice PDF, `Content-Disposition: inline` (phones open their PDF viewer), `Cache-Control: private, no-store`. Stamps `first_viewed_at` + one `invoice.opened` comms row on the first open. |
| `GET /api/public/documents/receipt/:id` | Canonical receipt twin (same headers; records `receipt.opened`). |
| `GET /i/:id`, `GET /r/:id` | Short aliases of the two above, for hosts that proxy root paths to Node (Docker, local, or a vhost that adds the nginx snippet below). |
| `GET /api/public/invoices/:brand/:id/view` | **301** → the canonical invoice URL. Every link already in an inbox or DM keeps working. |
| `GET /api/public/receipts/:brand/:id/view` | **301** → the canonical receipt URL. |

`:id` is the row's UUIDv4 — unguessable, and the only credential on the link.
Brand is resolved from the row, so it never rides in the path (short links,
no wrong-brand URLs).

### Why the canonical path is under `/api/public`

Every vhost in this repo (hub, both brand apexes, kaizen) proxies `/api/*` and
`/media/*` to the Node app and serves everything else from nginx/the SPA
(`docs/STOREFRONT_DEPLOYMENT.md` §7, `docs/UPLOAD_SIZE_LIMITS.md`). A prettier
root path like `/i/<uuid>` therefore lands on the SPA — and a customer would
get a login screen. That is the same failure class this change fixes, so the
canonical link lives where the proxy is guaranteed.

The short aliases still work: they are mounted before the SPA fallback in
`src/server.js` (Node-served hosts), and on SPA-serving hosts
`apps/admin/src/pages/DocumentLinkRedirect.tsx` bounces `/i|/r/<uuid>` straight
to the canonical API URL — so a short link opened anywhere still reaches the
PDF.

To make the short paths first-class (no redirect hop), add to the hub vhost:

```nginx
location ~ ^/[ir]/[0-9a-fA-F-]{36}$ {
    proxy_pass http://127.0.0.1:7000;
    include /etc/nginx/proxy_params;
}
```

See `ops/hub/nginx-document-links.conf`. Nothing breaks if you skip it.

## Which file is served

1. The **archived document** from the Documents vault (the send flow already
   archives the PDFs on dispatch) — instant, no Puppeteer per open, and the
   same bytes the customer would have received by email.
2. Only when nothing is archived: a one-off render through
   `pdf.service.renderAndStore` (which then archives it, so the next open is
   instant). Receipts handed to the sales module's order receipt when the
   receipt settles the invoice in full; partial receipts render from the
   receipt row so the order's "paid in full" document never masquerades as a
   partial one.

## Staff surfaces

- **Invoice drawer → "Copy customer link"** (and **Share**, where the device
  has `navigator.share`) hands over the canonical URL. This is the fix for the
  *other* half of the incident: an operator shared a `blob:` object URL (valid
  only inside their own browser session) because the drawer offered no way to
  get the real link.
- **Messaging composer → Invoices tile** (WhatsApp: right of Template;
  Instagram: right of WhatsApp us) opens a searchable invoice picker — greps
  customer name, invoice #, order #, or the order's line items, and shows
  invoice number, customer, order number, order details, balance and status.
  The chosen invoice can be shared as a **link** (dropped into the composer to
  edit before sending) or as a **PDF**, which is sent immediately as a
  document message via
  `POST /api/v1/smartcomm/channels/:id/send-invoice-pdf` (`{ invoice_id,
  is_human_agent? }`, gated like the invoice card: `smartcomm.edit` +
  `invoicing.view`). The server resolves the PDF through
  `invoicing.ensureInvoiceDocument`, so the operator needs no documents-module
  permissions and nothing browser-local (`blob:`) can end up in the chat.
  Void/refunded invoices are refused with 409.

## Channel behaviour of "Share PDF"

- **WhatsApp**: the PDF is uploaded to Meta and arrives as a native document.
- **Instagram**: IG DMs have no document attachment type; the backend sends
  `📄 Invoice ….pdf: <url>` instead of failing, so the customer still gets the
  file (and the picker's copy says so).

Both routes are covered by contract tests:
`tests/unit/invoicing/public-document-routes.test.js` (HTTP surface: 200 PDF,
301 legacy, 404 unknown) and `tests/unit/invoicing/public-document-view.test.js`
(first-view stamping, archived-vs-render resolution).

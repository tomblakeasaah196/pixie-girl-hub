/**
 * The customer-facing document links — one place, so the invoice drawer, the
 * messaging picker and anything added later all hand out exactly the same URL
 * the emailed/WhatsApped copy carries.
 *
 * Path note: these ride `/api/public/documents/...` on purpose. Every vhost in
 * this repo proxies `/api/*` to the Node app while serving everything else
 * from nginx/SPA, so this is the only path guaranteed to reach the backend on
 * every host. The pretty `/i/<uuid>` and `/r/<uuid>` aliases exist for
 * Node-served hosts (and the SPA redirects to this canonical form when it
 * catches them); see ops/hub/nginx-document-links.conf.
 *
 * The admin app and the public document routes are same-origin in every
 * deployment (both served by the hub), so `window.location.origin` IS the hub
 * domain — nothing to keep in sync via env.
 */

/** `https://hub…/api/public/documents/invoice/<uuid>` — serves the branded PDF. */
export function invoiceDocumentUrl(invoiceId: string): string {
  return `${window.location.origin}/api/public/documents/invoice/${invoiceId}`;
}

/** `https://hub…/api/public/documents/receipt/<uuid>` — serves the receipt PDF. */
export function receiptDocumentUrl(receiptId: string): string {
  return `${window.location.origin}/api/public/documents/receipt/${receiptId}`;
}

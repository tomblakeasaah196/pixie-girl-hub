import { Navigate, useLocation } from "react-router-dom";
import { ModulePlaceholder } from "./ModulePlaceholder";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SPA catch-all (replaces the bare ModulePlaceholder at `path: "*"`).
 *
 * A BARE UUID as the whole path — e.g. `/50d9a628-…`, what you get when a
 * customer-facing document link is opened on the hub origin, or an invoice
 * id is pasted straight into the address bar — is almost always someone
 * looking for that invoice. Route them to its drawer (Invoicing reads
 * `?invoice=<id>`) instead of the generic "The <uuid> module renders here"
 * dead end. Every other unmatched path is still an unbuilt module, so it
 * keeps the scaffold.
 */
export function CatchAll() {
  const { pathname } = useLocation();
  const seg = pathname.replace(/^\/+|\/+$/g, "");
  if (UUID_RE.test(seg)) {
    return <Navigate to={`/invoicing?invoice=${seg}`} replace />;
  }
  return <ModulePlaceholder />;
}

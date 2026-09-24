import { useQuery } from "@tanstack/react-query";
import { getCareEnabled } from "@/lib/storefront";

/*
 * Care & Accessories (PXG retail) — shared website pieces.
 *
 * Two rules from the owner decisions drive everything here:
 *
 *  1. The delivery disclosure string is EXACT and owner-approved:
 *     "EXTRA DELIVERY FEES MAY APPLY". It renders bold + uppercase with the
 *     word MAY never changed to WILL — a live notice is not consent to an
 *     unknown future charge, and the fee is genuinely undetermined until a
 *     staff member calculates it (see the guide's money-path gate).
 *
 *  2. The section is PXG-only and feature-gated on the SERVER. FLH, and PXG
 *     with FEATURE_PXG_CARE_ACCESSORIES_ENABLED off, both 404 — so the nav
 *     link and the routes must ask `getCareEnabled` before rendering rather
 *     than trusting the host or a client flag.
 */

/** The exact notice copy. Exported so tests can assert on the string itself
 *  rather than a copy that drifted in one place. */
export const CARE_DELIVERY_NOTICE = "EXTRA DELIVERY FEES MAY APPLY";

/**
 * Whether Care & Accessories is live for THIS brand/host. Resolved from the
 * server gate (`/care/enabled`), never from a client-side assumption. Safe to
 * call from several components — react-query dedupes it.
 */
export function useCareEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["care-enabled"],
    queryFn: async () => {
      try {
        const r = await getCareEnabled();
        // Tolerate a bare boolean too, in case the envelope shape changes.
        return typeof r === "boolean" ? r : Boolean(r?.enabled);
      } catch {
        // A 404 here means "not available for this brand" — the correct and
        // expected answer for FLH and for PXG before the gate is lifted.
        return false;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  return data === true;
}

/**
 * The mandatory bold-uppercase delivery disclosure for a basket containing
 * Care & Accessories items. Render it wherever that order's delivery amount is
 * shown — before payment and in the confirmation.
 *
 * `notice` comes from the server (`care_delivery_notice`) so the copy can never
 * be invented client-side; when the server omits it we fall back to the exact
 * constant above rather than paraphrasing.
 */
export function CareDeliveryNotice({
  notice,
  className = "",
}: {
  notice?: string | null;
  className?: string;
}) {
  const text = (notice ?? CARE_DELIVERY_NOTICE).trim();
  return (
    <p
      // The string is a fixed, server-supplied literal — no interpolation, no
      // user content — so innerHTML is not needed and is deliberately avoided.
      role="note"
      data-testid="care-delivery-notice"
      className={`font-bold uppercase tracking-wide ${className}`}
    >
      {text}
    </p>
  );
}

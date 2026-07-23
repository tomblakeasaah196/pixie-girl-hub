import { api } from "@/lib/api";
import type { GeoSuggestion } from "@/components/common/GeoapifyAddressSearch";

/**
 * Delivery-address search for the public Walk-in QR form — proxies the
 * server-side Geoapify integration (src/services/geoapify.service.js), the
 * same one HR's office-location picker and the customer-onboarding form use.
 * Brand-scoped rather than token-gated: the walk-in link is a standing
 * per-brand QR, not a one-time submission token. No API key ever reaches
 * the browser.
 */
export const searchWalkInAddress = (
  brand: string,
  text: string,
): Promise<GeoSuggestion[]> =>
  api.get<GeoSuggestion[]>(
    `/walk-in/${encodeURIComponent(brand)}/geo/search?text=${encodeURIComponent(text)}`,
    "public",
  );

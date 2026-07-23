import { api } from "@/lib/api";

/**
 * Delivery-address search for the public customer-onboarding form — proxies
 * the server-side Geoapify integration (src/services/geoapify.service.js),
 * the same one HR's office-location picker uses. No API key ever reaches
 * the browser; token-gated on the backend (see customer-onboarding routes).
 */
export interface OnboardingGeoSuggestion {
  formatted: string;
  lat: number;
  lng: number;
  place_id: string | null;
  category: string | null;
  address_line1: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  state_code: string | null;
  postcode: string | null;
  country: string | null;
  country_code: string | null;
}

export const searchOnboardingAddress = (
  token: string,
  text: string,
): Promise<OnboardingGeoSuggestion[]> =>
  api.get<OnboardingGeoSuggestion[]>(
    `/onboarding/${token}/geo/search?text=${encodeURIComponent(text)}`,
    "public",
  );

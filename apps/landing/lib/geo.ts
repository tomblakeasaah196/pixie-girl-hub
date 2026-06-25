"use client";

/**
 * Geo options + delivery helpers for the live checkout autofill.
 *
 * Primary source is the Hub's `/api/public/storefront/geo-options`, which is
 * derived from the seeded delivery zones — so every `code` here matches a real
 * zone and the delivery quote resolves exactly. The static fallbacks below keep
 * the checkout fully usable if that call ever fails (codes still match the
 * seed). Country list = the DHL-served countries + Nigeria; selecting a non-NG
 * country routes the fee to DHL by ISO-2 code. Nigerian states + Lagos LGAs are
 * the only lists we autofill — every other country free-types its region/city.
 */

export interface GeoOption {
  name: string;
  code: string;
}
export interface GeoOptions {
  countries: GeoOption[];
  nigeria_states: GeoOption[];
  lagos_lgas: GeoOption[];
}

export const NIGERIA_STATES_FALLBACK: GeoOption[] = [
  { name: "Abia", code: "NG-AB" },
  { name: "Adamawa", code: "NG-AD" },
  { name: "Akwa Ibom", code: "NG-AK" },
  { name: "Anambra", code: "NG-AN" },
  { name: "Bauchi", code: "NG-BA" },
  { name: "Bayelsa", code: "NG-BY" },
  { name: "Benue", code: "NG-BE" },
  { name: "Borno", code: "NG-BO" },
  { name: "Cross River", code: "NG-CR" },
  { name: "Delta", code: "NG-DE" },
  { name: "Ebonyi", code: "NG-EB" },
  { name: "Edo", code: "NG-ED" },
  { name: "Ekiti", code: "NG-EK" },
  { name: "Enugu", code: "NG-EN" },
  { name: "FCT (Abuja)", code: "NG-FC" },
  { name: "Gombe", code: "NG-GO" },
  { name: "Imo", code: "NG-IM" },
  { name: "Jigawa", code: "NG-JI" },
  { name: "Kaduna", code: "NG-KD" },
  { name: "Kano", code: "NG-KN" },
  { name: "Katsina", code: "NG-KT" },
  { name: "Kebbi", code: "NG-KE" },
  { name: "Kogi", code: "NG-KO" },
  { name: "Kwara", code: "NG-KW" },
  { name: "Lagos", code: "NG-LA" },
  { name: "Nasarawa", code: "NG-NA" },
  { name: "Niger", code: "NG-NI" },
  { name: "Ogun", code: "NG-OG" },
  { name: "Ondo", code: "NG-ON" },
  { name: "Osun", code: "NG-OS" },
  { name: "Oyo", code: "NG-OY" },
  { name: "Plateau", code: "NG-PL" },
  { name: "Rivers", code: "NG-RI" },
  { name: "Sokoto", code: "NG-SO" },
  { name: "Taraba", code: "NG-TA" },
  { name: "Yobe", code: "NG-YO" },
  { name: "Zamfara", code: "NG-ZA" },
];

export const LAGOS_LGAS_FALLBACK: GeoOption[] = [
  { name: "Agege", code: "NG-LA-AGEGE" },
  { name: "Ajeromi-Ifelodun", code: "NG-LA-AJEROMI" },
  { name: "Alimosho", code: "NG-LA-ALIMOSHO" },
  { name: "Amuwo-Odofin", code: "NG-LA-AMUWO" },
  { name: "Apapa", code: "NG-LA-APAPA" },
  { name: "Badagry", code: "NG-LA-BADAGRY" },
  { name: "Epe", code: "NG-LA-EPE" },
  { name: "Eti-Osa (Lekki, VI, Ikoyi)", code: "NG-LA-ETI-OSA" },
  { name: "Ibeju-Lekki", code: "NG-LA-IBEJU" },
  { name: "Ifako-Ijaiye", code: "NG-LA-IFAKO" },
  { name: "Ikeja", code: "NG-LA-IKEJA" },
  { name: "Ikorodu", code: "NG-LA-IKORODU" },
  { name: "Kosofe", code: "NG-LA-KOSOFE" },
  { name: "Lagos Island", code: "NG-LA-ISLAND" },
  { name: "Lagos Mainland (Yaba, etc.)", code: "NG-LA-MAINLAND" },
  { name: "Mushin", code: "NG-LA-MUSHIN" },
  { name: "Ojo", code: "NG-LA-OJO" },
  { name: "Oshodi-Isolo", code: "NG-LA-OSHODI" },
  { name: "Shomolu", code: "NG-LA-SHOMOLU" },
  { name: "Surulere", code: "NG-LA-SURULERE" },
];

// Nigeria first, then alphabetical. Codes are ISO 3166-1 alpha-2.
export const COUNTRIES_FALLBACK: GeoOption[] = [
  { name: "Nigeria", code: "NG" },
  { name: "Afghanistan", code: "AF" },
  { name: "Albania", code: "AL" },
  { name: "Algeria", code: "DZ" },
  { name: "Andorra", code: "AD" },
  { name: "Angola", code: "AO" },
  { name: "Antigua and Barbuda", code: "AG" },
  { name: "Argentina", code: "AR" },
  { name: "Armenia", code: "AM" },
  { name: "Australia", code: "AU" },
  { name: "Austria", code: "AT" },
  { name: "Azerbaijan", code: "AZ" },
  { name: "Bahamas", code: "BS" },
  { name: "Bahrain", code: "BH" },
  { name: "Bangladesh", code: "BD" },
  { name: "Barbados", code: "BB" },
  { name: "Belarus", code: "BY" },
  { name: "Belgium", code: "BE" },
  { name: "Belize", code: "BZ" },
  { name: "Benin", code: "BJ" },
  { name: "Bhutan", code: "BT" },
  { name: "Bolivia", code: "BO" },
  { name: "Bosnia and Herzegovina", code: "BA" },
  { name: "Botswana", code: "BW" },
  { name: "Brazil", code: "BR" },
  { name: "Brunei", code: "BN" },
  { name: "Bulgaria", code: "BG" },
  { name: "Burkina Faso", code: "BF" },
  { name: "Burundi", code: "BI" },
  { name: "Cabo Verde", code: "CV" },
  { name: "Cambodia", code: "KH" },
  { name: "Cameroon", code: "CM" },
  { name: "Canada", code: "CA" },
  { name: "Central African Republic", code: "CF" },
  { name: "Chad", code: "TD" },
  { name: "Chile", code: "CL" },
  { name: "China", code: "CN" },
  { name: "Colombia", code: "CO" },
  { name: "Comoros", code: "KM" },
  { name: "Costa Rica", code: "CR" },
  { name: "Cote d'Ivoire", code: "CI" },
  { name: "Croatia", code: "HR" },
  { name: "Cuba", code: "CU" },
  { name: "Cyprus", code: "CY" },
  { name: "Czechia", code: "CZ" },
  { name: "Democratic Republic of the Congo", code: "CD" },
  { name: "Denmark", code: "DK" },
  { name: "Djibouti", code: "DJ" },
  { name: "Dominica", code: "DM" },
  { name: "Dominican Republic", code: "DO" },
  { name: "Ecuador", code: "EC" },
  { name: "Egypt", code: "EG" },
  { name: "El Salvador", code: "SV" },
  { name: "Equatorial Guinea", code: "GQ" },
  { name: "Eritrea", code: "ER" },
  { name: "Estonia", code: "EE" },
  { name: "Eswatini", code: "SZ" },
  { name: "Ethiopia", code: "ET" },
  { name: "Fiji", code: "FJ" },
  { name: "Finland", code: "FI" },
  { name: "France", code: "FR" },
  { name: "Gabon", code: "GA" },
  { name: "Gambia", code: "GM" },
  { name: "Georgia", code: "GE" },
  { name: "Germany", code: "DE" },
  { name: "Ghana", code: "GH" },
  { name: "Greece", code: "GR" },
  { name: "Grenada", code: "GD" },
  { name: "Guatemala", code: "GT" },
  { name: "Guinea", code: "GN" },
  { name: "Guinea-Bissau", code: "GW" },
  { name: "Guyana", code: "GY" },
  { name: "Haiti", code: "HT" },
  { name: "Holy See (Vatican City)", code: "VA" },
  { name: "Honduras", code: "HN" },
  { name: "Hungary", code: "HU" },
  { name: "Iceland", code: "IS" },
  { name: "India", code: "IN" },
  { name: "Indonesia", code: "ID" },
  { name: "Iran", code: "IR" },
  { name: "Iraq", code: "IQ" },
  { name: "Ireland", code: "IE" },
  { name: "Israel", code: "IL" },
  { name: "Italy", code: "IT" },
  { name: "Jamaica", code: "JM" },
  { name: "Japan", code: "JP" },
  { name: "Jordan", code: "JO" },
  { name: "Kazakhstan", code: "KZ" },
  { name: "Kenya", code: "KE" },
  { name: "Kiribati", code: "KI" },
  { name: "Kuwait", code: "KW" },
  { name: "Kyrgyzstan", code: "KG" },
  { name: "Laos", code: "LA" },
  { name: "Latvia", code: "LV" },
  { name: "Lebanon", code: "LB" },
  { name: "Lesotho", code: "LS" },
  { name: "Liberia", code: "LR" },
  { name: "Libya", code: "LY" },
  { name: "Liechtenstein", code: "LI" },
  { name: "Lithuania", code: "LT" },
  { name: "Luxembourg", code: "LU" },
  { name: "Madagascar", code: "MG" },
  { name: "Malawi", code: "MW" },
  { name: "Malaysia", code: "MY" },
  { name: "Maldives", code: "MV" },
  { name: "Mali", code: "ML" },
  { name: "Malta", code: "MT" },
  { name: "Marshall Islands", code: "MH" },
  { name: "Mauritania", code: "MR" },
  { name: "Mauritius", code: "MU" },
  { name: "Mexico", code: "MX" },
  { name: "Micronesia", code: "FM" },
  { name: "Moldova", code: "MD" },
  { name: "Monaco", code: "MC" },
  { name: "Mongolia", code: "MN" },
  { name: "Montenegro", code: "ME" },
  { name: "Morocco", code: "MA" },
  { name: "Mozambique", code: "MZ" },
  { name: "Myanmar", code: "MM" },
  { name: "Namibia", code: "NA" },
  { name: "Nauru", code: "NR" },
  { name: "Nepal", code: "NP" },
  { name: "Netherlands", code: "NL" },
  { name: "New Zealand", code: "NZ" },
  { name: "Nicaragua", code: "NI" },
  { name: "Niger", code: "NE" },
  { name: "North Korea", code: "KP" },
  { name: "North Macedonia", code: "MK" },
  { name: "Norway", code: "NO" },
  { name: "Oman", code: "OM" },
  { name: "Pakistan", code: "PK" },
  { name: "Palau", code: "PW" },
  { name: "Palestine", code: "PS" },
  { name: "Panama", code: "PA" },
  { name: "Papua New Guinea", code: "PG" },
  { name: "Paraguay", code: "PY" },
  { name: "Peru", code: "PE" },
  { name: "Philippines", code: "PH" },
  { name: "Poland", code: "PL" },
  { name: "Portugal", code: "PT" },
  { name: "Qatar", code: "QA" },
  { name: "Republic of the Congo", code: "CG" },
  { name: "Romania", code: "RO" },
  { name: "Russia", code: "RU" },
  { name: "Rwanda", code: "RW" },
  { name: "Saint Kitts and Nevis", code: "KN" },
  { name: "Saint Lucia", code: "LC" },
  { name: "Saint Vincent and the Grenadines", code: "VC" },
  { name: "Samoa", code: "WS" },
  { name: "San Marino", code: "SM" },
  { name: "Sao Tome and Principe", code: "ST" },
  { name: "Saudi Arabia", code: "SA" },
  { name: "Senegal", code: "SN" },
  { name: "Serbia", code: "RS" },
  { name: "Seychelles", code: "SC" },
  { name: "Sierra Leone", code: "SL" },
  { name: "Singapore", code: "SG" },
  { name: "Slovakia", code: "SK" },
  { name: "Slovenia", code: "SI" },
  { name: "Solomon Islands", code: "SB" },
  { name: "Somalia", code: "SO" },
  { name: "South Africa", code: "ZA" },
  { name: "South Korea", code: "KR" },
  { name: "South Sudan", code: "SS" },
  { name: "Spain", code: "ES" },
  { name: "Sri Lanka", code: "LK" },
  { name: "Sudan", code: "SD" },
  { name: "Suriname", code: "SR" },
  { name: "Sweden", code: "SE" },
  { name: "Switzerland", code: "CH" },
  { name: "Syria", code: "SY" },
  { name: "Tajikistan", code: "TJ" },
  { name: "Tanzania", code: "TZ" },
  { name: "Thailand", code: "TH" },
  { name: "Timor-Leste", code: "TL" },
  { name: "Togo", code: "TG" },
  { name: "Tonga", code: "TO" },
  { name: "Trinidad and Tobago", code: "TT" },
  { name: "Tunisia", code: "TN" },
  { name: "Turkey", code: "TR" },
  { name: "Turkmenistan", code: "TM" },
  { name: "Tuvalu", code: "TV" },
  { name: "Uganda", code: "UG" },
  { name: "Ukraine", code: "UA" },
  { name: "United Arab Emirates", code: "AE" },
  { name: "United Kingdom", code: "GB" },
  { name: "United States", code: "US" },
  { name: "Uruguay", code: "UY" },
  { name: "Uzbekistan", code: "UZ" },
  { name: "Vanuatu", code: "VU" },
  { name: "Venezuela", code: "VE" },
  { name: "Vietnam", code: "VN" },
  { name: "Yemen", code: "YE" },
  { name: "Zambia", code: "ZM" },
  { name: "Zimbabwe", code: "ZW" },
];

export const GEO_FALLBACK: GeoOptions = {
  countries: COUNTRIES_FALLBACK,
  nigeria_states: NIGERIA_STATES_FALLBACK,
  lagos_lgas: LAGOS_LGAS_FALLBACK,
};

function brandQuery(brand?: string): string {
  return brand ? `?brand=${encodeURIComponent(brand)}` : "";
}

/** fetch with a hard timeout so a hung backend can never leave the checkout
 *  spinning ("Calculating…" forever / a dead picker). On timeout the request is
 *  aborted and the caller falls back to its bundled defaults. */
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  ms = 8000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch picker options from the Hub. The bundled lists are the floor: until
 *  the delivery zones are seeded the endpoint returns only Nigeria, so we keep
 *  whichever list is more complete per field. The buyer therefore always sees
 *  every country / NG state / Lagos LGA, and once zones are seeded the endpoint
 *  (whose codes match the bundled list) takes over and reflects any imports. */
export async function fetchGeoOptions(brand?: string): Promise<GeoOptions> {
  const fuller = (remote: GeoOption[] | undefined, local: GeoOption[]) =>
    Array.isArray(remote) && remote.length >= local.length ? remote : local;
  try {
    const res = await fetchWithTimeout(
      `/api/public/storefront/geo-options${brandQuery(brand)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return GEO_FALLBACK;
    const json = (await res.json()) as { data?: Partial<GeoOptions> };
    const d = json?.data;
    if (!d) return GEO_FALLBACK;
    return {
      countries: fuller(d.countries, COUNTRIES_FALLBACK),
      nigeria_states: fuller(d.nigeria_states, NIGERIA_STATES_FALLBACK),
      lagos_lgas: fuller(d.lagos_lgas, LAGOS_LGAS_FALLBACK),
    };
  } catch {
    return GEO_FALLBACK;
  }
}

export interface PickupAddress {
  address: string | null;
  phone: string | null;
}

/** Business "collect in store" address from Business Setup. */
export async function fetchPickupAddress(
  brand?: string,
): Promise<PickupAddress> {
  try {
    const res = await fetchWithTimeout(
      `/api/public/storefront/pickup-address${brandQuery(brand)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return { address: null, phone: null };
    const json = (await res.json()) as { data?: PickupAddress };
    return json?.data ?? { address: null, phone: null };
  } catch {
    return { address: null, phone: null };
  }
}

export type DeliveryFeeStatus =
  | "priced" // a real positive fee
  | "free" // intentional free delivery (promo / VIP) → ₦0 by design
  | "pending" // resolved to ₦0 with no free marker → confirmed before dispatch
  | "unserviceable"; // no zone covers this location → cannot ship here

export interface DeliveryQuote {
  zone_name: string | null;
  courier_key: string | null;
  fee_ngn: number | null;
  fee_status: DeliveryFeeStatus | null;
  currency: string;
}

/** Quote the delivery fee for a zone code (NG state/LGA or ISO-2 country) and
 *  wig quantity. Returns null fee when the zone isn't covered. */
export async function fetchDeliveryQuote(args: {
  brand?: string;
  zoneCode: string;
  qty: number;
}): Promise<DeliveryQuote | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/public/storefront/delivery-quote${brandQuery(args.brand)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ country: args.zoneCode, qty: args.qty }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: DeliveryQuote };
    const d = json?.data;
    if (!d) return null;
    return {
      zone_name: d.zone_name ?? null,
      courier_key: d.courier_key ?? null,
      fee_ngn: d.fee_ngn != null ? Number(d.fee_ngn) : null,
      fee_status: d.fee_status ?? null,
      currency: d.currency || "NGN",
    };
  } catch {
    return null;
  }
}

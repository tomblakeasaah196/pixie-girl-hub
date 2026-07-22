/**
 * CRM — country ↔ dialing-code helpers.
 *
 * Pure functions (no DB, no I/O) so they're trivially unit-testable and can be
 * shared by the clients filter (crm.repo) and the backfill script.
 *
 * Two "country code" notions live in the product and people conflate them:
 *   - phone dialing code — the +234 / +44 you dial (variable length, 1–4 digits)
 *   - ISO 3166-1 alpha-2 — the NG / GB stored on shared.contacts.country_code
 * The clients filter accepts EITHER and resolves to both so it can match a
 * contact by phone prefix OR by the (sparser) country_code column.
 *
 * The map is deliberately a focused set — every African country plus the major
 * diaspora / trade destinations for two Nigerian businesses — not an
 * exhaustive ITU table. Unknown-but-numeric input still yields a usable dial
 * prefix; unknown ISO input still filters the country_code column.
 */

"use strict";

// Dialing code (digits, no '+') → ISO 3166-1 alpha-2.
// NANP (+1) collapses to US — we can't tell US from CA without the area code.
const DIAL_TO_ISO = {
  1: "US",
  7: "RU",
  20: "EG",
  27: "ZA",
  30: "GR",
  31: "NL",
  32: "BE",
  33: "FR",
  34: "ES",
  39: "IT",
  41: "CH",
  43: "AT",
  44: "GB",
  45: "DK",
  46: "SE",
  47: "NO",
  48: "PL",
  49: "DE",
  51: "PE",
  52: "MX",
  54: "AR",
  55: "BR",
  56: "CL",
  57: "CO",
  60: "MY",
  61: "AU",
  62: "ID",
  63: "PH",
  64: "NZ",
  65: "SG",
  66: "TH",
  81: "JP",
  82: "KR",
  84: "VN",
  86: "CN",
  90: "TR",
  91: "IN",
  92: "PK",
  212: "MA",
  213: "DZ",
  216: "TN",
  220: "GM",
  221: "SN",
  223: "ML",
  224: "GN",
  225: "CI",
  226: "BF",
  227: "NE",
  228: "TG",
  229: "BJ",
  231: "LR",
  232: "SL",
  233: "GH",
  234: "NG",
  235: "TD",
  236: "CF",
  237: "CM",
  241: "GA",
  242: "CG",
  243: "CD",
  244: "AO",
  249: "SD",
  250: "RW",
  251: "ET",
  252: "SO",
  254: "KE",
  255: "TZ",
  256: "UG",
  257: "BI",
  258: "MZ",
  260: "ZM",
  263: "ZW",
  264: "NA",
  265: "MW",
  267: "BW",
  351: "PT",
  353: "IE",
  358: "FI",
  852: "HK",
  880: "BD",
  961: "LB",
  962: "JO",
  965: "KW",
  966: "SA",
  968: "OM",
  971: "AE",
  972: "IL",
  973: "BH",
  974: "QA",
};

// ISO → dialing code (first ISO seen wins; NANP maps back to '1' via US).
const ISO_TO_DIAL = Object.entries(DIAL_TO_ISO).reduce((acc, [dial, iso]) => {
  if (!acc[iso]) acc[iso] = String(dial);
  return acc;
}, {});

// Longest-first so the greedy prefix match resolves '212' (MA) before '21'.
const DIAL_CODES_LONGEST_FIRST = Object.keys(DIAL_TO_ISO)
  .map(String)
  .sort((a, b) => b.length - a.length);

/** Strip everything but digits. `+234 (0)80-123` → `234080123`. */
function digitsOnly(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

/** Longest known dialing code that `digits` starts with, or null. */
function matchDialCode(digits) {
  for (const code of DIAL_CODES_LONGEST_FIRST) {
    if (digits.startsWith(code)) return code;
  }
  return null;
}

/**
 * Resolve a user-typed country filter into { iso, dial } — either may be null.
 * Accepts an ISO2 ("NG", "gb"), a dialing code ("+234", "234"), or even a full
 * phone number (resolves to its country). Both outputs are used by the filter:
 * `dial` powers the phone-prefix match, `iso` powers the country_code fallback.
 */
function resolveCountry(input) {
  const raw = String(input || "").trim();
  if (!raw) return { iso: null, dial: null };

  // ISO2 form: two letters, no digits.
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const iso = raw.toUpperCase();
    return { iso, dial: ISO_TO_DIAL[iso] || null };
  }

  const digits = digitsOnly(raw);
  if (!digits) return { iso: null, dial: null };

  const dial = matchDialCode(digits);
  // Unknown code: still let the caller prefix-match on the digits they typed.
  return { iso: dial ? DIAL_TO_ISO[dial] : null, dial: dial || digits };
}

/**
 * Best-effort ISO2 for a stored phone number, used by the backfill.
 *   - a leading '+' is trusted as the international marker → map the code
 *   - a 234… number is Nigeria whether or not the '+' was kept
 *   - otherwise it's a local number → assume the home country (a Nigerian
 *     business stores most numbers as 080…), null if no home country given
 * Returns null when nothing can be said with confidence.
 */
function isoFromPhone(phone, homeIso = null) {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  const digits = digitsOnly(raw);
  if (!digits) return null;

  if (digits.startsWith("234")) return "NG";
  if (raw.startsWith("+") || raw.startsWith("00")) {
    // '00' is the other international prefix (ITU) some contacts save.
    const trimmed = raw.startsWith("00") ? digits.replace(/^0+/, "") : digits;
    const code = matchDialCode(trimmed);
    return code ? DIAL_TO_ISO[code] : null;
  }
  return homeIso ? String(homeIso).toUpperCase() : null;
}

module.exports = {
  DIAL_TO_ISO,
  ISO_TO_DIAL,
  digitsOnly,
  matchDialCode,
  resolveCountry,
  isoFromPhone,
};

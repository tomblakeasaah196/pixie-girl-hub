import { useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { AnchoredDropdown } from "@/components/ui/AnchoredDropdown";

/**
 * Delivery-address search backed by Geoapify — provider-agnostic over
 * WHICH server-side proxy answers `search` (onboarding is token-gated,
 * walk-in is brand-scoped; both forward to src/services/geoapify.service.js
 * and never ship an API key to the browser). Type-ahead: a dropdown of
 * suggestions appears as the customer types; picking one fills the
 * structured address fields below.
 *
 * Both callers (CustomerOnboardingPublic, WalkInPublic) render this inside a
 * Collapsible section, whose `overflow-hidden` root clips a plain
 * `absolute`-positioned dropdown at the section's edge — the suggestions
 * looked "invisible", really just clipped/overlapping the field below. A
 * body-level AnchoredDropdown portal sidesteps that entirely (same fix as
 * the catalogue ProductPicker).
 */
export interface GeoSuggestion {
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

export interface GeoAddress {
  line1: string;
  area: string;
  city: string;
  state: string;
  country: string;
  country_code: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  formatted_address: string;
}

function toGeoAddress(s: GeoSuggestion): GeoAddress {
  return {
    line1: s.address_line1 || s.formatted.split(",")[0] || "",
    area: "",
    // Nigeria's LGA surfaces as Geoapify's `county` — prefer it; fall back
    // to `city` for addresses (mostly non-Nigerian) that only carry that.
    city: s.county || s.city || "",
    state: s.state || "",
    country: s.country || "",
    country_code: s.country_code || "",
    postal_code: s.postcode || "",
    latitude: Number.isFinite(s.lat) ? s.lat : null,
    longitude: Number.isFinite(s.lng) ? s.lng : null,
    formatted_address: s.formatted,
  };
}

interface Props {
  /** Resolves a typed query to ranked suggestions — bind the right proxy per caller. */
  search: (text: string) => Promise<GeoSuggestion[]>;
  value: string;
  onChange: (raw: string) => void;
  onAddressSelected: (address: GeoAddress) => void;
  placeholder?: string;
}

export function GeoapifyAddressSearch({
  search,
  value,
  onChange,
  onAddressSelected,
  placeholder = "Start typing your address…",
}: Props) {
  const [results, setResults] = useState<GeoSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleType = (text: string) => {
    onChange(text);
    clearTimeout(debounce.current);
    if (text.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await search(text);
        setResults(r);
        setOpen(r.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleType(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full h-[42px] pl-9 pr-8 rounded-xl bg-panel-2 border hairline text-[13.5px] outline-none focus:border-accent/40"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint animate-spin" />
      )}
      <AnchoredDropdown
        anchorRef={inputRef}
        open={open && results.length > 0}
        onClose={() => setOpen(false)}
        maxHeight={260}
        className="bg-panel-2 border hairline shadow-lg"
      >
        {results.map((r, i) => (
          <button
            key={r.place_id ?? i}
            type="button"
            onClick={() => {
              onChange(r.address_line1 || r.formatted);
              onAddressSelected(toGeoAddress(r));
              setResults([]);
              setOpen(false);
            }}
            className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-text-primary/[0.06] transition-colors border-b hairline last:border-0"
          >
            <MapPin className="w-3.5 h-3.5 text-text-faint shrink-0 mt-0.5" />
            <span className="text-[12.5px] leading-snug">{r.formatted}</span>
          </button>
        ))}
      </AnchoredDropdown>
    </div>
  );
}

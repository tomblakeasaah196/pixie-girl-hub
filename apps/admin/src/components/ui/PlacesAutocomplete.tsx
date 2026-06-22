import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2, LocateFixed, CheckCircle2 } from "lucide-react";
import {
  captureDeviceLocation,
  fetchSuggestions,
  newSessionToken,
  placesAvailable,
  resolvePlace,
  type PlaceAddress,
  type PlaceSuggestion,
} from "@/lib/places";

export type { PlaceAddress } from "@/lib/places";

interface Props {
  /** Controlled text shown in the field. */
  value: string;
  /** Raw typing. */
  onChange: (raw: string) => void;
  /** A place was picked (full address) or GPS captured (coords only — parents
   *  merge defensively, so empty siblings never wipe existing values). */
  onResolved: (addr: PlaceAddress) => void;
  /** ISO region codes to restrict (e.g. ["ng"]). null/empty = worldwide. */
  regionCodes?: string[] | null;
  placeholder?: string;
  required?: boolean;
  /** Opt-in: only customer-facing forms capture the *device's* location. */
  enableGps?: boolean;
  /** Seed the "location pinned" chip when editing an existing address. */
  initialCoords?: { latitude: number; longitude: number; google_maps_url?: string } | null;
  inputClassName?: string;
  id?: string;
}

const EMPTY: PlaceAddress = {
  line1: "",
  line2: "",
  area: "",
  city: "",
  state: "",
  country: "",
  country_code: "",
  postal_code: "",
  latitude: null,
  longitude: null,
  google_maps_url: "",
  formatted_address: "",
};

/**
 * Address autocomplete on the new Places API (data API + our own themed
 * dropdown), with an optional device-GPS fallback. Degrades to a plain,
 * typeable input when no Maps key is configured — and GPS still works there,
 * so we can always capture a lat/lng.
 */
export function PlacesAutocomplete({
  value,
  onChange,
  onResolved,
  regionCodes = ["ng"],
  placeholder = "Start typing your street, estate or landmark…",
  required,
  enableGps = false,
  initialCoords = null,
  inputClassName,
  id,
}: Props) {
  const [status, setStatus] = useState<"checking" | "ready" | "manual">(
    "checking",
  );
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [coords, setCoords] = useState(initialCoords);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const tokenRef = useRef<ReturnType<typeof newSessionToken>>(undefined);
  const debounceRef = useRef<number | null>(null);
  const blurRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await placesAvailable();
      if (!cancelled) setStatus(ok ? "ready" : "manual");
    })();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (blurRef.current) window.clearTimeout(blurRef.current);
    };
  }, []);

  function queryChanged(v: string) {
    onChange(v);
    if (status !== "ready") return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (v.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      if (!tokenRef.current) tokenRef.current = newSessionToken();
      setLoadingSugg(true);
      try {
        const s = await fetchSuggestions(v, {
          sessionToken: tokenRef.current,
          regionCodes,
        });
        setSuggestions(s);
        setOpen(s.length > 0);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoadingSugg(false);
      }
    }, 250);
  }

  async function choose(s: PlaceSuggestion) {
    setOpen(false);
    setSuggestions([]);
    try {
      const addr = await resolvePlace(s.prediction);
      if (addr) {
        // Update the visible field first, then emit structured data LAST so a
        // parent's defensive merge keeps the parsed line1 (not the long
        // formatted string) and the freshly-parsed city/state/coords.
        onChange(addr.formatted_address || addr.line1 || s.primary);
        onResolved(addr);
        if (addr.latitude != null && addr.longitude != null) {
          setCoords({
            latitude: addr.latitude,
            longitude: addr.longitude,
            google_maps_url: addr.google_maps_url,
          });
        }
      }
    } catch {
      /* selection failed — leave the typed text in place */
    }
    tokenRef.current = undefined; // session ends at the detail fetch
  }

  async function useMyLocation() {
    setGpsBusy(true);
    setGpsError(null);
    try {
      const c = await captureDeviceLocation();
      onResolved({ ...EMPTY, latitude: c.latitude, longitude: c.longitude, google_maps_url: c.google_maps_url });
      setCoords(c);
    } catch (e) {
      setGpsError(e instanceof Error ? e.message : "Couldn't get your location");
    } finally {
      setGpsBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        void choose(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const baseInput =
    inputClassName ??
    "w-full h-[42px] rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors";

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-[21px] -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none z-10" />
      <input
        id={id}
        type="text"
        value={value}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => queryChanged(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => {
          // Delay so a click on an option registers before we close.
          blurRef.current = window.setTimeout(() => setOpen(false), 160);
        }}
        placeholder={
          status === "checking"
            ? "Loading Maps…"
            : status === "manual"
              ? "Type your full address"
              : placeholder
        }
        className={`${baseInput} pl-9 pr-9`}
      />
      {(loadingSugg || status === "checking") && (
        <Loader2 className="absolute right-3 top-[21px] -translate-y-1/2 w-3.5 h-3.5 text-text-faint animate-spin pointer-events-none" />
      )}

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-xl bg-panel/95 backdrop-blur-xl border hairline shadow-glass overflow-hidden max-h-[260px] overflow-y-auto"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId || i}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus; beat the blur timer
                void choose(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-3 py-2 cursor-pointer flex items-start gap-2 ${
                i === activeIndex ? "bg-text-primary/[0.08]" : ""
              }`}
            >
              <MapPin className="w-3.5 h-3.5 text-text-faint mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block text-[13px] text-text-primary truncate">
                  {s.primary}
                </span>
                {s.secondary && (
                  <span className="block text-[11px] text-text-faint truncate">
                    {s.secondary}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {status === "manual" && (
        <p className="text-[10.5px] text-text-faint mt-1">
          Map autocomplete isn&rsquo;t available right now — typing your address
          works fine, our rider will still find you.
        </p>
      )}

      {enableGps && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={useMyLocation}
            disabled={gpsBusy}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-accent-glow hover:text-accent disabled:opacity-60 transition-colors"
          >
            {gpsBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LocateFixed className="w-3.5 h-3.5" />
            )}
            Use my current location
          </button>
          {coords && (
            <a
              href={
                coords.google_maps_url ||
                `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`
              }
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-success"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Location pinned · view on map
            </a>
          )}
        </div>
      )}
      {gpsError && <p className="text-[10.5px] text-warn/90 mt-1">{gpsError}</p>}
    </div>
  );
}

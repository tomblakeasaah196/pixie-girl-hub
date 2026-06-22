/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { MapPin, Loader2 } from "lucide-react";

// Prefer the shared Places key (used by the Online-QR loader); fall back to the
// older name so a single env var powers every address field in the app.
const MAPS_KEY = (import.meta.env.VITE_GOOGLE_PLACES_API_KEY ??
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined;

/** Parsed address components from a Google Places result. */
export interface PlaceAddress {
  line1: string;
  line2: string;
  area: string;
  city: string;
  state: string;
  country: string;
  country_code: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string;
  formatted_address: string;
}

function parseComponents(place: google.maps.places.PlaceResult): PlaceAddress {
  const comps = place.address_components ?? [];
  const get = (...types: string[]) =>
    comps.find((c) => types.some((t) => c.types.includes(t)))?.long_name ?? "";
  const getShort = (...types: string[]) =>
    comps.find((c) => types.some((t) => c.types.includes(t)))?.short_name ?? "";

  const streetNumber = get("street_number");
  const route = get("route");
  const premise = get("premise", "establishment", "point_of_interest");
  const sublocality = get("sublocality_level_1", "sublocality", "neighborhood");
  const locality = get("locality", "postal_town");
  const adminArea1 = get("administrative_area_level_1");
  const countryLong = get("country");
  const countryShort = getShort("country");
  const postalCode = get("postal_code");

  const line1Parts = [streetNumber, route].filter(Boolean);
  const line1 = line1Parts.length ? line1Parts.join(" ") : premise;

  return {
    line1: line1 || get("formatted_address").split(",")[0] || "",
    line2: premise && line1 !== premise ? premise : "",
    area: sublocality,
    city: locality,
    state: adminArea1,
    country: countryLong,
    country_code: countryShort,
    postal_code: postalCode,
    latitude: place.geometry?.location?.lat() ?? null,
    longitude: place.geometry?.location?.lng() ?? null,
    google_maps_url: place.url ?? "",
    formatted_address: place.formatted_address ?? "",
  };
}

let loaderPromise: Promise<google.maps.PlacesLibrary> | null = null;

async function loadGoogleMaps() {
  if (!MAPS_KEY) return null;
  if (loaderPromise) return loaderPromise;
  setOptions({ key: MAPS_KEY, v: "weekly" });
  loaderPromise = importLibrary("places");
  return loaderPromise;
}

interface Props extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {
  value: string;
  onChange: (raw: string) => void;
  onPlaceSelected: (place: PlaceAddress) => void;
  /** ISO 3166-1 alpha-2 country code to bias results. Defaults to "NG". */
  countryCode?: string;
  placeholder?: string;
}

/**
 * Address autocomplete backed by Google Places API.
 * Smart country bias — biases to `countryCode` but accepts worldwide results.
 * Falls back to a plain text input if VITE_GOOGLE_MAPS_KEY is not set.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  countryCode = "NG",
  placeholder = "Start typing an address…",
  className,
  ...rest
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // Load Google Maps once on mount
  useEffect(() => {
    setLoading(true);
    loadGoogleMaps()
      .then((lib) => {
        // Only mark ready when the library actually loaded. Without a key
        // loadGoogleMaps() resolves to null — marking ready then would send
        // the effect below into the (undefined) global `google` and throw
        // "google is not defined", crashing the whole public form.
        if (lib) setReady(true);
      })
      .catch(() => {
        /* key not set or network error — degrade to plain input */
      })
      .finally(() => setLoading(false));
  }, []);

  // Wire autocomplete once the API is ready and the input is mounted
  useEffect(() => {
    if (!ready || !inputRef.current) return;
    if (typeof google === "undefined" || !google.maps?.places) return;

    acRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ["address_components", "geometry", "formatted_address", "url"],
      componentRestrictions: { country: countryCode.toLowerCase() },
    });

    const listener = acRef.current.addListener("place_changed", () => {
      const place = acRef.current!.getPlace();
      if (!place?.address_components) return;
      const parsed = parseComponents(place);
      onChange(parsed.line1);
      onPlaceSelected(parsed);
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Update country restriction whenever countryCode prop changes
  useEffect(() => {
    if (!acRef.current) return;
    acRef.current.setComponentRestrictions({
      country: countryCode.toLowerCase(),
    });
  }, [countryCode]);

  const inputClasses = [
    "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line",
    "text-[13px] text-text-primary placeholder:text-text-faint",
    "focus:outline-none focus:border-accent/50 transition-colors",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          !MAPS_KEY
            ? "Maps API key not set — type manually"
            : loading
              ? "Loading Maps…"
              : placeholder
        }
        className={inputClasses.replace("px-[13px]", "pl-9 pr-3")}
        autoComplete="off"
        {...rest}
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint animate-spin pointer-events-none" />
      )}
      {!MAPS_KEY && (
        <p className="text-[10px] text-warn/80 mt-1">
          Set <span className="font-mono">VITE_GOOGLE_PLACES_API_KEY</span> to
          enable autocomplete — typing the address still works.
        </p>
      )}
    </div>
  );
}

/** Static map image for a confirmed address (Google Maps Static API). */
export function StaticMapImage({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label?: string;
}) {
  if (!MAPS_KEY) return null;

  const src = [
    "https://maps.googleapis.com/maps/api/staticmap",
    `?center=${lat},${lng}`,
    "&zoom=15",
    "&size=320x160",
    "&scale=2",
    `&markers=color:red%7Clabel:${label ? encodeURIComponent(label[0]) : "P"}%7C${lat},${lng}`,
    `&key=${MAPS_KEY}`,
    "&style=feature:poi|visibility:simplified",
  ].join("");

  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      className="block w-full overflow-hidden rounded-[10px] border hairline mt-2 group"
    >
      <img
        src={src}
        alt="Map preview"
        className="w-full h-[100px] object-cover group-hover:opacity-90 transition-opacity"
        loading="lazy"
      />
    </a>
  );
}

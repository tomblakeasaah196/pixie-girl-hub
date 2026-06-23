/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { MapPin, Loader2 } from "lucide-react";
import { getMapsApiKey } from "@/lib/runtime-config";

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

function parseNewPlace(place: google.maps.places.Place): PlaceAddress {
  const comps = place.addressComponents ?? [];
  const get = (...types: string[]) =>
    comps.find((c) => types.some((t) => c.types.includes(t)))?.longText ?? "";
  const getShort = (...types: string[]) =>
    comps.find((c) => types.some((t) => c.types.includes(t)))?.shortText ?? "";

  const streetNumber = get("street_number");
  const route = get("route");
  const premise = get("premise", "establishment", "point_of_interest");
  const sublocality = get("sublocality_level_1", "sublocality", "neighborhood");
  const locality = get("locality", "postal_town");
  const adminArea1 = get("administrative_area_level_1");
  const countryLong = get("country");
  const countryShort = getShort("country");
  const postalCode = get("postal_code");
  const formatted = place.formattedAddress ?? "";

  const line1Parts = [streetNumber, route].filter(Boolean);
  const line1 = line1Parts.length ? line1Parts.join(" ") : premise;

  return {
    line1: line1 || formatted.split(",")[0] || "",
    line2: premise && line1 !== premise ? premise : "",
    area: sublocality,
    city: locality,
    state: adminArea1,
    country: countryLong,
    country_code: countryShort,
    postal_code: postalCode,
    latitude: place.location?.lat() ?? null,
    longitude: place.location?.lng() ?? null,
    google_maps_url: place.googleMapsURI ?? "",
    formatted_address: formatted,
  };
}

let loaderPromise: Promise<google.maps.PlacesLibrary> | null = null;

async function loadGoogleMaps() {
  // Key resolved at runtime (server config) so it can be set without a rebuild.
  const key = await getMapsApiKey();
  if (!key) return null;
  if (loaderPromise) return loaderPromise;
  setOptions({ key, v: "weekly" });
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
  const hostRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  onPlaceSelectedRef.current = onPlaceSelected;
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  // null = still checking; false = no key (degrade); true = key present.
  const [configured, setConfigured] = useState<boolean | null>(null);

  // Resolve the key + load Google Maps once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = await getMapsApiKey();
      if (cancelled) return;
      setConfigured(Boolean(key));
      if (!key) {
        setLoading(false);
        return;
      }
      try {
        // Only mark ready when the library actually loaded. Without a key
        // loadGoogleMaps() resolves to null — marking ready then would send
        // the effect below into the (undefined) global `google` and throw
        // "google is not defined", crashing the whole public form.
        const lib = await loadGoogleMaps();
        if (!cancelled && lib) setReady(true);
      } catch {
        /* network error — degrade to plain input */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount the Places API (New) autocomplete element once the API is ready.
  // Replaces the deprecated google.maps.places.Autocomplete (legacy Places API).
  useEffect(() => {
    if (!ready) return;
    const host = hostRef.current;
    if (!host) return;
    if (
      typeof google === "undefined" ||
      !google.maps?.places?.PlaceAutocompleteElement
    )
      return;

    let el: google.maps.places.PlaceAutocompleteElement;
    try {
      el = new google.maps.places.PlaceAutocompleteElement({
        includedRegionCodes: [countryCode.toLowerCase()],
      });
      el.placeholder = placeholder;
      el.style.width = "100%";
      if (value) el.value = value;
      host.replaceChildren(el);
    } catch {
      return; // element unavailable — fallback input stays
    }
    elRef.current = el;

    // Typing (no selection yet) still updates the parent's raw value so a
    // hand-typed address can be submitted. `input` is a composed event and
    // bubbles out of the element's shadow DOM.
    const onInput = () => onChangeRef.current(el.value);
    const onSelect = (async (event: Event) => {
      try {
        // Select event ships under two shapes across Maps versions:
        //   gmp-select → event.placePrediction.toPlace(); gmp-placeselect → event.place
        const anyEv = event as unknown as {
          placePrediction?: google.maps.places.PlacePrediction;
          place?: google.maps.places.Place;
        };
        const place = anyEv.placePrediction?.toPlace() ?? anyEv.place ?? null;
        if (!place) return;
        await place.fetchFields({
          fields: [
            "addressComponents",
            "formattedAddress",
            "location",
            "googleMapsURI",
            "displayName",
          ],
        });
        const parsed = parseNewPlace(place);
        onChangeRef.current(parsed.line1);
        onPlaceSelectedRef.current(parsed);
      } catch (err) {
        console.warn("[AddressAutocomplete] selection failed", err);
      }
    }) as (e: Event) => void;

    el.addEventListener("input", onInput);
    el.addEventListener("gmp-select", onSelect);
    el.addEventListener("gmp-placeselect", onSelect);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("gmp-select", onSelect);
      el.removeEventListener("gmp-placeselect", onSelect);
      el.remove();
      elRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Update region bias whenever the countryCode prop changes
  useEffect(() => {
    if (elRef.current) {
      elRef.current.includedRegionCodes = [countryCode.toLowerCase()];
    }
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
      {/* Places API (New) widget mounts here once ready. Always present
          (hidden until ready) so the effect has a mount point. */}
      <div
        ref={hostRef}
        className="gpac-host rounded-[11px] overflow-hidden"
        style={{ display: ready ? "block" : "none" }}
      />
      {!ready && (
        <>
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              configured === false
                ? "Type your full address"
                : loading || configured === null
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
        </>
      )}
      {configured === false && (
        <p className="text-[10px] text-text-faint mt-1">
          Map autocomplete isn&rsquo;t available right now — typing your address
          works fine, our rider will still find you.
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
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMapsApiKey().then((k) => {
      if (!cancelled) setKey(k);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!key) return null;

  const src = [
    "https://maps.googleapis.com/maps/api/staticmap",
    `?center=${lat},${lng}`,
    "&zoom=15",
    "&size=320x160",
    "&scale=2",
    `&markers=color:red%7Clabel:${label ? encodeURIComponent(label[0]) : "P"}%7C${lat},${lng}`,
    `&key=${key}`,
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

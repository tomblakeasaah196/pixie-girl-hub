import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2, AlertCircle } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

/**
 * Reusable Google Places autocomplete + map pin field.
 *
 * Used by the Online QR welcome form. Restricted to Nigeria by default
 * with an "international" toggle for diaspora orders. On selection we
 * fan out the address into structured pieces (line1 / area / city /
 * state / lat / lng / google_maps_url) via the `onChange` callback so
 * the parent form can submit them straight to `contact_addresses`.
 *
 * When the API key isn't configured, the component degrades to a plain
 * text input + a "Maps not configured" hint, so the form still works.
 */

export interface PlaceFields {
  line1: string;
  line2?: string;
  area?: string;
  city: string;
  state: string;
  country: string;
  country_code: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  google_maps_url?: string;
  formatted_address: string;
}

interface Props {
  label: string;
  initial?: Partial<PlaceFields>;
  required?: boolean;
  onChange: (fields: PlaceFields) => void;
  countryRestriction?: "ng" | null;
  className?: string;
}

const NG_BOUNDS = { south: 4.0, west: 2.5, north: 14.0, east: 15.0 };

export function GooglePlacesAutocomplete({
  label,
  initial,
  required,
  onChange,
  countryRestriction = "ng",
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Host for Google's PlaceAutocompleteElement (Places API New). Always in the
  // DOM (hidden until ready) so the effect has somewhere to mount the widget.
  const pacHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(
    null,
  );
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [value, setValue] = useState(initial?.formatted_address ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial?.latitude && initial?.longitude
      ? { lat: initial.latitude, lng: initial.longitude }
      : null,
  );
  const [status, setStatus] = useState<
    "loading" | "ready" | "unavailable" | "error"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    let el: google.maps.places.PlaceAutocompleteElement | null = null;
    let onSelect: ((e: Event) => void) | null = null;
    (async () => {
      try {
        // loadGoogleMaps() resolves the key at runtime (server config) and
        // returns null when none is set — degrade to a typeable field then.
        const g = await loadGoogleMaps();
        if (cancelled) return;
        if (!g || !g.maps.places?.PlaceAutocompleteElement) {
          setStatus("unavailable");
          return;
        }
        const host = pacHostRef.current;
        if (!host) return;

        // Places API (New) autocomplete — replaces the deprecated, legacy
        // google.maps.places.Autocomplete (which needed the legacy Places API
        // enabled). This runs on "Places API (New)".
        el = new g.maps.places.PlaceAutocompleteElement({
          includedRegionCodes:
            countryRestriction === "ng" ? ["ng"] : undefined,
          locationBias: countryRestriction === "ng" ? NG_BOUNDS : undefined,
        });
        el.style.width = "100%";
        el.placeholder = "Start typing your address…";
        if (value) el.value = value;
        host.replaceChildren(el);

        onSelect = (async (event: Event) => {
          try {
            // Select event ships under two shapes across Maps versions:
            //   gmp-select → event.placePrediction.toPlace(); gmp-placeselect → event.place
            const anyEv = event as unknown as {
              placePrediction?: google.maps.places.PlacePrediction;
              place?: google.maps.places.Place;
            };
            const place =
              anyEv.placePrediction?.toPlace() ?? anyEv.place ?? null;
            if (!place) return;
            await place.fetchFields({
              fields: [
                "addressComponents",
                "formattedAddress",
                "location",
                "displayName",
                "googleMapsURI",
              ],
            });
            const fields = parseNewPlace(place);
            if (fields.latitude == null || fields.longitude == null) return;
            setValue(fields.formatted_address);
            setCoords({ lat: fields.latitude, lng: fields.longitude });
            drawPin(g, fields.latitude, fields.longitude);
            onChangeRef.current(fields);
          } catch (err) {
            console.warn("[GooglePlacesAutocomplete] selection failed", err);
          }
        }) as (e: Event) => void;
        el.addEventListener("gmp-select", onSelect);
        el.addEventListener("gmp-placeselect", onSelect);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (el && onSelect) {
        el.removeEventListener("gmp-select", onSelect);
        el.removeEventListener("gmp-placeselect", onSelect);
      }
      el?.remove();
    };
    // value is seeded once; re-running on every keystroke would remount the widget
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryRestriction]);

  // Once we have coords (initial or selected) render a small map.
  useEffect(() => {
    if (status !== "ready" || !coords || !mapRef.current) return;
    (async () => {
      const g = await loadGoogleMaps();
      if (!g) return;
      drawPin(g, coords.lat, coords.lng);
    })();
  }, [status, coords]);

  function drawPin(g: typeof google, lat: number, lng: number) {
    if (!mapRef.current) return;
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new g.maps.Map(mapRef.current, {
        center: { lat, lng },
        zoom: 16,
        disableDefaultUI: true,
        gestureHandling: "cooperative",
        mapId: "DEMO_MAP_ID",
      });
    } else {
      mapInstanceRef.current.setCenter({ lat, lng });
      mapInstanceRef.current.setZoom(16);
    }
    if (markerRef.current) {
      markerRef.current.position = { lat, lng };
    } else if (g.maps.marker) {
      markerRef.current = new g.maps.marker.AdvancedMarkerElement({
        map: mapInstanceRef.current,
        position: { lat, lng },
      });
    }
  }

  return (
    <div className={className}>
      <label className="block">
        <span className="block text-[11.5px] text-text-muted mb-1">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </span>
        <div className="relative">
          {/* Places API (New) widget mounts here once ready. Always present
              (hidden until ready) so the effect has a mount point. */}
          <div
            ref={pacHostRef}
            className="gpac-host rounded-xl overflow-hidden"
            style={{ display: status === "ready" ? "block" : "none" }}
          />
          {status !== "ready" && (
            <>
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  setValue(v);
                  // In degraded modes there's no Places listener, so the typed
                  // text would never reach the parent and the address (a
                  // required field) could never be filled. Surface it as line1;
                  // empty siblings are ignored by the parent's defensive merge.
                  if (status === "unavailable" || status === "error") {
                    onChange({
                      line1: v,
                      city: "",
                      state: "",
                      country: "",
                      country_code: "",
                      formatted_address: v,
                    });
                  }
                }}
                placeholder={
                  status === "unavailable"
                    ? "Type your full address"
                    : "Start typing your address…"
                }
                required={required}
                className="w-full pl-9 pr-9 py-2 rounded-xl bg-panel-2 border hairline text-[13.5px] focus:outline-none focus:border-accent/40"
              />
              {status === "loading" && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-text-faint" />
              )}
            </>
          )}
        </div>
      </label>

      {status === "unavailable" && (
        <p className="mt-1.5 text-[10.5px] text-text-faint inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Map autocomplete not configured — typing works fine, our rider will
          still find you.
        </p>
      )}
      {status === "error" && (
        <p className="mt-1.5 text-[10.5px] text-amber-300 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Map service hiccup — please type your address.
        </p>
      )}

      {coords && status === "ready" && (
        <div
          ref={mapRef}
          className="mt-2 w-full h-[160px] rounded-xl overflow-hidden border hairline"
          aria-label="Map preview of your address"
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────

/** Read a component from a Places API (New) Place by type. */
function compNew(
  components: google.maps.places.AddressComponent[],
  type: string,
  short = false,
): string | undefined {
  const m = components.find((c) => c.types.includes(type));
  if (!m) return undefined;
  return (short ? m.shortText : m.longText) ?? undefined;
}

function parseNewPlace(place: google.maps.places.Place): PlaceFields {
  const comps = place.addressComponents ?? [];
  const streetNumber = compNew(comps, "street_number");
  const route = compNew(comps, "route");
  const line1 =
    [streetNumber, route].filter(Boolean).join(" ") ||
    (place.displayName ?? place.formattedAddress ?? "");
  const area =
    compNew(comps, "sublocality_level_1") ||
    compNew(comps, "sublocality") ||
    compNew(comps, "neighborhood") ||
    undefined;
  const city =
    compNew(comps, "locality") ||
    compNew(comps, "administrative_area_level_2") ||
    "Lagos";
  const state = compNew(comps, "administrative_area_level_1") || "Lagos";
  const country = compNew(comps, "country") || "Nigeria";
  const country_code = compNew(comps, "country", true) || "NG";
  const postal_code = compNew(comps, "postal_code");
  const loc = place.location;
  return {
    line1,
    area,
    city,
    state,
    country,
    country_code,
    postal_code,
    latitude: loc?.lat(),
    longitude: loc?.lng(),
    google_maps_url: place.googleMapsURI ?? undefined,
    formatted_address: place.formattedAddress ?? "",
  };
}

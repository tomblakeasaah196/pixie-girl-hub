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
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(
    null,
  );
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
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
    (async () => {
      try {
        // loadGoogleMaps() resolves the key at runtime (server config) and
        // returns null when none is set — degrade to a typeable field then.
        const g = await loadGoogleMaps();
        if (cancelled) return;
        if (!g) {
          setStatus("unavailable");
          return;
        }
        if (!inputRef.current) return;
        const ac = new g.maps.places.Autocomplete(inputRef.current, {
          fields: [
            "address_components",
            "formatted_address",
            "geometry",
            "name",
            "place_id",
            "url",
          ],
          types: ["address"],
          componentRestrictions:
            countryRestriction === "ng" ? { country: "ng" } : undefined,
          bounds: countryRestriction === "ng" ? NG_BOUNDS : undefined,
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place || !place.geometry || !place.geometry.location) return;
          const fields = parsePlace(place);
          setValue(fields.formatted_address);
          setCoords({ lat: fields.latitude!, lng: fields.longitude! });
          drawPin(g, fields.latitude!, fields.longitude!);
          onChange(fields);
        });
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryRestriction, onChange]);

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
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              setValue(v);
              // In degraded modes there's no Places listener, so the typed text
              // would never reach the parent and the address (a required field)
              // could never be filled. Surface it as line1; empty siblings are
              // ignored by the parent's defensive merge.
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

function comp(
  components: google.maps.GeocoderAddressComponent[],
  type: string,
  short = false,
): string | undefined {
  const m = components.find((c) => c.types.includes(type));
  if (!m) return undefined;
  return short ? m.short_name : m.long_name;
}

function parsePlace(place: google.maps.places.PlaceResult): PlaceFields {
  const comps = place.address_components ?? [];
  const streetNumber = comp(comps, "street_number");
  const route = comp(comps, "route");
  const line1 =
    [streetNumber, route].filter(Boolean).join(" ") ||
    (place.name ?? place.formatted_address ?? "");
  const area =
    comp(comps, "sublocality_level_1") ||
    comp(comps, "sublocality") ||
    comp(comps, "neighborhood") ||
    undefined;
  const city =
    comp(comps, "locality") ||
    comp(comps, "administrative_area_level_2") ||
    "Lagos";
  const state = comp(comps, "administrative_area_level_1") || "Lagos";
  const country = comp(comps, "country") || "Nigeria";
  const country_code = comp(comps, "country", true) || "NG";
  const postal_code = comp(comps, "postal_code");
  const loc = place.geometry?.location;
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
    google_maps_url: place.url,
    formatted_address: place.formatted_address ?? "",
  };
}

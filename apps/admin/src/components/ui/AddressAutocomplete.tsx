import { useEffect, useState } from "react";
import { getMapsApiKey } from "@/lib/runtime-config";
import { PlacesAutocomplete, type PlaceAddress } from "./PlacesAutocomplete";

export type { PlaceAddress } from "./PlacesAutocomplete";

interface Props {
  value: string;
  onChange: (raw: string) => void;
  onPlaceSelected: (place: PlaceAddress) => void;
  /** ISO 3166-1 alpha-2 country code to bias results. Defaults to "NG". */
  countryCode?: string;
  placeholder?: string;
  /** Opt-in device-GPS button (customer-facing forms only). */
  enableGps?: boolean;
}

/**
 * Address autocomplete backed by the new Google Places API. Thin wrapper around
 * the shared <PlacesAutocomplete/> so every caller (Quick Sale, contact address
 * modal, public Walk-in form) gets the same themed dropdown + graceful
 * degrade. Falls back to a plain text input when no Maps key is configured.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  countryCode = "NG",
  placeholder = "Start typing an address…",
  enableGps = false,
}: Props) {
  return (
    <PlacesAutocomplete
      value={value}
      onChange={onChange}
      onResolved={onPlaceSelected}
      regionCodes={countryCode ? [countryCode.toLowerCase()] : null}
      placeholder={placeholder}
      enableGps={enableGps}
    />
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

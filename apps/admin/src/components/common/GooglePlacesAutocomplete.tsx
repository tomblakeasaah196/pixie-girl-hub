import { useState } from "react";
import {
  PlacesAutocomplete,
  type PlaceAddress,
} from "@/components/ui/PlacesAutocomplete";

/**
 * Reusable address autocomplete + GPS field for the Online-QR welcome form.
 *
 * Thin wrapper over the shared <PlacesAutocomplete/> (new Places API + themed
 * dropdown + "use my current location"). Keeps the original `onChange`
 * (PlaceFields) contract so the onboarding form's defensive merge is unchanged.
 * Degrades to a plain text input when no Maps key is configured.
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

export function GooglePlacesAutocomplete({
  label,
  initial,
  required,
  onChange,
  countryRestriction = "ng",
  className,
}: Props) {
  const [value, setValue] = useState(
    initial?.formatted_address ?? initial?.line1 ?? "",
  );

  function handleResolved(a: PlaceAddress) {
    setValue(a.formatted_address || a.line1 || "");
    onChange({
      line1: a.line1,
      line2: a.line2 || undefined,
      area: a.area || undefined,
      city: a.city,
      state: a.state,
      country: a.country,
      country_code: a.country_code,
      postal_code: a.postal_code || undefined,
      latitude: a.latitude ?? undefined,
      longitude: a.longitude ?? undefined,
      google_maps_url: a.google_maps_url || undefined,
      formatted_address: a.formatted_address || a.line1 || "",
    });
  }

  return (
    <div className={className}>
      <label className="block">
        <span className="block text-[11.5px] text-text-muted mb-1">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </span>
        <PlacesAutocomplete
          value={value}
          onChange={(v) => {
            setValue(v);
            // Manual typing: surface the text as line1 (empty siblings are
            // ignored by the parent's defensive merge). A selection emits the
            // full structured address right after via onResolved.
            onChange({
              line1: v,
              city: "",
              state: "",
              country: "",
              country_code: "",
              formatted_address: v,
            });
          }}
          onResolved={handleResolved}
          regionCodes={countryRestriction === "ng" ? ["ng"] : null}
          required={required}
          enableGps
          initialCoords={
            initial?.latitude != null && initial?.longitude != null
              ? {
                  latitude: initial.latitude,
                  longitude: initial.longitude,
                  google_maps_url: initial.google_maps_url,
                }
              : null
          }
          placeholder="Start typing your address…"
          inputClassName="w-full rounded-xl bg-panel-2 border hairline text-[13.5px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40"
        />
      </label>
    </div>
  );
}

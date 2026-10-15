import { useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, AlertCircle } from "lucide-react";
import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { cn } from "@/lib/cn";
import { AnchoredDropdown } from "@/components/ui/AnchoredDropdown";

/**
 * Phone number field with a searchable country/dial-code picker — the
 * country is never optional (a bare local number is unusable for delivery
 * or WhatsApp), and the number is validated per-country as the user types.
 */
export interface PhoneValue {
  country: CountryCode;
  national: string;
}

export const DEFAULT_PHONE_VALUE: PhoneValue = { country: "NG", national: "" };

/** ISO 3166-1 alpha-2 → flag emoji via Unicode regional indicators. No image assets. */
function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

let displayNames: Intl.DisplayNames | null | undefined;
function countryName(iso2: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  return displayNames?.of(iso2) ?? iso2;
}

interface CountryOption {
  code: CountryCode;
  name: string;
  dial: string;
  flag: string;
}

let cachedList: CountryOption[] | null = null;
/** Every country libphonenumber-js knows a dial code for, Nigeria first. */
function countryList(): CountryOption[] {
  if (cachedList) return cachedList;
  const list = getCountries()
    .map((code) => ({
      code,
      name: countryName(code),
      dial: getCountryCallingCode(code),
      flag: flagEmoji(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ngIndex = list.findIndex((c) => c.code === "NG");
  if (ngIndex > 0) list.unshift(list.splice(ngIndex, 1)[0]);
  cachedList = list;
  return list;
}

/** E.164 string ("+2348012345678") once the number validates for its country; null otherwise. */
export function phoneToE164(v: PhoneValue): string | null {
  if (!v.national.trim()) return null;
  if (!isValidPhoneNumber(v.national, v.country)) return null;
  return parsePhoneNumberFromString(v.national, v.country)?.number ?? null;
}

interface Props {
  label: string;
  value: PhoneValue;
  onChange: (v: PhoneValue) => void;
  required?: boolean;
  placeholder?: string;
}

export function PhoneField({
  label,
  value,
  onChange,
  required,
  placeholder = "801 234 5678",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const countryButtonRef = useRef<HTMLButtonElement>(null);

  const options = countryList();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.dial.includes(q) ||
        o.code.toLowerCase() === q,
    );
  }, [options, query]);

  const current = options.find((o) => o.code === value.country) ?? options[0];
  const touched = value.national.trim().length > 0;
  const valid = !touched || isValidPhoneNumber(value.national, value.country);

  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      <div className="flex min-w-0 gap-1.5">
        <div className="relative shrink-0">
          <button
            ref={countryButtonRef}
            type="button"
            aria-label={`Country code: ${current.name} +${current.dial}`}
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setQuery("");
            }}
            className="h-[42px] px-2.5 rounded-xl bg-panel-2 border hairline text-[13.5px] flex items-center gap-1 whitespace-nowrap"
          >
            <span aria-hidden>{current.flag}</span>
            <span className="text-text-muted">+{current.dial}</span>
            <ChevronDown className="w-3 h-3 text-text-faint" />
          </button>
          <AnchoredDropdown
            anchorRef={countryButtonRef}
            open={open}
            onClose={() => setOpen(false)}
            maxHeight={320}
            mobileMinWidth={280}
            className="rounded-xl border hairline bg-panel-2 shadow-lg"
          >
            <div className="p-2 border-b hairline">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Country or code…"
                  className="w-full h-9 pl-8 pr-2 rounded-lg bg-bg border hairline text-[13px] outline-none focus:border-accent/40"
                />
              </div>
            </div>
            <div className="max-h-[260px] overflow-y-auto py-1">
              {filtered.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  onClick={() => {
                    onChange({ ...value, country: o.code });
                    setOpen(false);
                  }}
                  className="w-full min-h-11 flex items-center gap-2 px-3 py-2 text-left text-[13px] whitespace-normal hover:bg-text-primary/[0.06] transition-colors"
                >
                  <span aria-hidden>{o.flag}</span>
                  <span className="min-w-0 flex-1 whitespace-normal break-words">{o.name}</span>
                  <span className="shrink-0 text-text-faint">+{o.dial}</span>
                  {o.code === value.country && (
                    <Check className="w-3.5 h-3.5 text-accent-glow shrink-0" />
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-[12px] text-text-faint text-center">
                  No matching country
                </p>
              )}
            </div>
          </AnchoredDropdown>
        </div>
        <input
          type="tel"
          inputMode="tel"
          value={value.national}
          onChange={(e) =>
            onChange({
              ...value,
              national: e.target.value.replace(/[^\d\s-]/g, ""),
            })
          }
          placeholder={placeholder}
          className={cn(
            "flex-1 min-w-0 h-[42px] px-3 rounded-xl bg-panel-2 border text-[13.5px] outline-none focus:border-accent/40",
            touched && !valid ? "border-danger/60" : "hairline",
          )}
        />
      </div>
      {touched && !valid && (
        <p className="text-[11px] text-danger mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          That doesn&rsquo;t look like a valid {current.name} number.
        </p>
      )}
    </label>
  );
}

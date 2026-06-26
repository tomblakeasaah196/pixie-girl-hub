import { useState, useRef, useEffect } from "react";
import { Coins } from "lucide-react";
import { CURRENCIES, useCurrency, type Currency } from "@/lib/currency";

const COUNTRY_OPTIONS: { code: string; label: string }[] = [
  { code: "NG", label: "Nigeria" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "GH", label: "Ghana" },
  { code: "KE", label: "Kenya" },
  { code: "AE", label: "UAE" },
];

export function CurrencySwitcher() {
  const { currency, setCurrency, geo, setCountryOverride, ratesSource } = useCurrency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-11 w-11 -m-2 items-center justify-center rounded-full text-taupe hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        aria-label={`Change currency · current ${currency} · region ${geo.countryCode}`}
        title={`${currency} · ${geo.countryCode}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Coins size={18} strokeWidth={1.6} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 w-64 bg-ink/95 backdrop-blur-xl border border-taupe/25 p-4 z-50 shadow-2xl">
          <p className="text-[0.55rem] tracking-[0.35em] uppercase text-taupe/80 mb-2">Currency</p>
          <div className="grid grid-cols-2 gap-1.5 mb-4">
            {CURRENCIES.map((c) => (
              <button
                key={c.code}
                onClick={() => { setCurrency(c.code as Currency); }}
                className={`py-2 text-[0.6rem] tracking-[0.25em] uppercase border transition-colors ${
                  currency === c.code
                    ? "bg-taupe text-ink border-taupe"
                    : "border-taupe/25 text-cream/75 hover:border-taupe"
                }`}
              >
                {c.symbol} {c.code}
              </button>
            ))}
          </div>

          <p className="text-[0.55rem] tracking-[0.35em] uppercase text-taupe/80 mb-2">
            Detected · {geo.country} <span className="text-cream/40">({geo.source})</span>
          </p>
          <select
            value={geo.countryCode}
            onChange={(e) => setCountryOverride(e.target.value)}
            className="w-full bg-transparent border border-taupe/30 text-cream text-xs py-2 px-2 outline-none focus:border-taupe"
          >
            {COUNTRY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code} className="bg-ink">{o.label}</option>
            ))}
          </select>

          <p className="text-[0.5rem] tracking-[0.18em] uppercase text-cream/40 mt-3 leading-relaxed">
            FX · {ratesSource === "live" ? "live rates" : "demo rates · live API pending"} ·
            checkout settles in {currency === "NGN" ? "NGN" : "USD"}
          </p>
        </div>
      )}
    </div>
  );
}

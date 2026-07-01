import { useState, useRef, useEffect } from "react";
import { Coins } from "lucide-react";
import { useCurrency } from "@/lib/useStore";
import type { Currency } from "@/lib/storefront";

const CURRENCIES: { code: Currency; symbol: string }[] = [
  { code: "NGN", symbol: "₦" },
  { code: "USD", symbol: "$" },
];

/**
 * Display-currency switcher. Reads/writes the storefront currency store
 * (NGN/USD); checkout settles NGN or USD via the Hub. No client-side FX math.
 */
export function CurrencySwitcher() {
  const [currency, setCurrency] = useCurrency();
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
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-1 text-[0.7rem] tracking-[0.2em] uppercase text-taupe hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        aria-label={`Change currency · current ${currency}`}
        title={currency}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Coins size={16} strokeWidth={1.6} aria-hidden="true" />
        <span>{currency}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 w-56 bg-ink/95 backdrop-blur-xl border border-taupe/25 p-4 z-50 shadow-2xl">
          <p className="text-[0.55rem] tracking-[0.35em] uppercase text-taupe/80 mb-2">Currency</p>
          <div className="grid grid-cols-2 gap-1.5">
            {CURRENCIES.map((c) => (
              <button
                key={c.code}
                onClick={() => {
                  setCurrency(c.code);
                  setOpen(false);
                }}
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
          <p className="text-[0.5rem] tracking-[0.18em] uppercase text-cream/40 mt-3 leading-relaxed">
            Checkout settles in {currency === "NGN" ? "NGN" : "USD"}
          </p>
        </div>
      )}
    </div>
  );
}

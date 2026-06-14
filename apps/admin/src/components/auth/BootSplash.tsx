import { useBranding } from "@/lib/branding";

/**
 * The brief, branded loading state shown while the session is restored
 * (and reused as the login splash). Pure tokens + glass — no hardcoded
 * colour. The monogram pulses; an indeterminate accent bar breathes.
 */
export function BootSplash({ label }: { label?: string }) {
  const { data } = useBranding();
  const p = data?.platform;
  const product = p?.product_name ?? "Pixie Girl Hub";
  const logo = p?.logo_dark_url ?? p?.logo_light_url ?? null;
  const mark = product.trim().charAt(0).toUpperCase() || "P";

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-bg">
      <div className="flex flex-col items-center">
        <div className="w-[104px] h-[104px] rounded-full grid place-items-center glass border border-accent/40 animate-splash-pulse overflow-hidden">
          {logo ? (
            <img
              src={logo}
              alt={product}
              className="w-full h-full object-contain p-4"
            />
          ) : (
            <span className="font-display text-accent-glow text-5xl">
              {mark}
            </span>
          )}
        </div>
        <div className="mt-8 w-[180px] h-[2px] rounded-full bg-text-primary/10 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-boot-bar" />
        </div>
        <div className="micro mt-5">{label ?? product}</div>
      </div>
    </div>
  );
}

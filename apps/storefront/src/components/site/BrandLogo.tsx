import type { ReactNode } from "react";
import { useBranding } from "@/lib/site-config";

/**
 * Theme-aware brand logo for the header and footer.
 *
 * Reads the operator's uploaded logos from Studio branding (via context) and
 * renders the dark-mode logo on the dark site and the light-mode logo on the
 * light site. The swap is pure CSS driven by the `.dark` class on <html> (set
 * before paint by the theme-boot script), so there is no flash and no
 * hydration mismatch. Header and footer share this component, so the same
 * asset always appears in both. Falls back to `fallback` (a text wordmark)
 * when nothing is uploaded.
 */
export function BrandLogo({
  imgClassName,
  fallback,
}: {
  imgClassName: string;
  fallback: ReactNode;
}) {
  const { name, logoDark, logoLight } = useBranding();
  const alt = name || "Logo";
  const dark = logoDark || logoLight;
  const light = logoLight || logoDark;

  if (!dark && !light) return <>{fallback}</>;

  // Only one asset (or the same for both) → render once, no theme toggle.
  if (!dark || !light || dark === light) {
    return (
      <img
        src={dark || light}
        alt={alt}
        width={709}
        height={274}
        className={imgClassName}
        draggable={false}
      />
    );
  }

  // Distinct dark/light logos → both are in the DOM; CSS shows the right one.
  return (
    <>
      <img
        src={light}
        alt={alt}
        width={709}
        height={274}
        className={`${imgClassName} block dark:hidden`}
        draggable={false}
      />
      <img
        src={dark}
        alt={alt}
        width={709}
        height={274}
        className={`${imgClassName} hidden dark:block`}
        draggable={false}
      />
    </>
  );
}

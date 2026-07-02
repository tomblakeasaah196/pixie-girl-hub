import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Renders a client-side <Link> for internal paths (no full reload, plays the
 * page transition) and a plain <a> for external / mailto / tel / hash links.
 * Use for content-driven hrefs (CTAs, footer, promo) that could be either.
 */
export function SmartLink({
  to,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const external =
    /^https?:\/\//i.test(to) ||
    to.startsWith("mailto:") ||
    to.startsWith("tel:") ||
    to.startsWith("#");
  if (external || !to.startsWith("/")) {
    return (
      <a
        href={to}
        className={className}
        aria-label={ariaLabel}
        target={/^https?:\/\//i.test(to) ? "_blank" : undefined}
        rel={/^https?:\/\//i.test(to) ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

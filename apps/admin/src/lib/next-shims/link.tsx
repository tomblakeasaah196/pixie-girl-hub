/**
 * Vite-side stand-in for `next/link`, used only when the admin renders the
 * shared @landing-kit Atelier components. Aliased in vite.config.ts. Renders a
 * plain <a>; the live Next.js site uses the real next/link.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children?: ReactNode;
};

export default function Link({
  href,
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  children,
  ...rest
}: NextLinkProps) {
  const resolved = typeof href === "string" ? href : (href?.pathname ?? "#");
  return (
    <a href={resolved} {...rest}>
      {children}
    </a>
  );
}

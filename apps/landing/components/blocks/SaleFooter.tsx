"use client";

import Link from "next/link";
import { Instagram, Mail } from "lucide-react";
import type { LandingPayload } from "@/lib/types";

export function SaleFooter({ payload }: { payload: LandingPayload }) {
  const brand = payload.brand?.display_name || "Pixie Girl Global";
  const storefront = payload.brand?.storefront_domain
    ? `https://${payload.brand.storefront_domain}`
    : "https://pixiegirlglobal.com";
  const support = payload.brand?.support_email;
  return (
    <footer className="mt-16 border-t border-[rgb(var(--gold)/0.16)]">
      <div className="mx-auto max-w-[1180px] px-6 md:px-10 py-14 grid grid-cols-1 md:grid-cols-3 gap-10 text-[13px] text-[rgb(var(--text-muted))]">
        <div className="space-y-3">
          <div className="font-display text-[24px] text-[rgb(var(--text))]">
            {brand}
          </div>
          <p className="max-w-[260px] leading-relaxed">
            A house for the women who get it. Quietly extraordinary, always
            limited.
          </p>
        </div>
        <div>
          <div className="eyebrow mb-3.5">Elsewhere</div>
          <ul className="space-y-2">
            <li>
              <Link
                href={storefront}
                className="hover:text-[rgb(var(--text))] transition-colors"
              >
                Main storefront →
              </Link>
            </li>
            <li>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[rgb(var(--text))] transition-colors"
              >
                <Instagram className="w-3.5 h-3.5 text-gold" /> Instagram
              </a>
            </li>
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-3.5">Reach us</div>
          {support ? (
            <a
              href={`mailto:${support}`}
              className="inline-flex items-center gap-1.5 hover:text-[rgb(var(--text))] transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-gold" /> {support}
            </a>
          ) : (
            <p>We answer every message, personally.</p>
          )}
        </div>
      </div>
      <div className="border-t border-[rgb(var(--border-c)/0.06)] py-5 text-center text-[11px] text-[rgb(var(--text-faint))]">
        © {new Date().getFullYear()} {brand}. The drop is real. The hair is
        real. The girl is you.
      </div>
    </footer>
  );
}

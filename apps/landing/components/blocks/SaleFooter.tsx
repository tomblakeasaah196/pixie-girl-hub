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
    <footer className="mt-16 border-t border-[rgb(var(--border-c)/0.08)]">
      <div className="mx-auto max-w-[1180px] px-6 md:px-10 py-10 grid grid-cols-1 md:grid-cols-3 gap-8 text-[13px] text-[rgb(var(--text-muted))]">
        <div>
          <div className="font-display text-[20px] text-[rgb(var(--text))]">
            {brand}
          </div>
          <p className="mt-2">A house for the women who get it.</p>
        </div>
        <div>
          <div className="micro mb-3">Elsewhere</div>
          <ul className="space-y-1.5">
            <li>
              <Link href={storefront} className="hover:text-[rgb(var(--text))]">
                Main storefront
              </Link>
            </li>
            <li>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[rgb(var(--text))]"
              >
                <Instagram className="w-3.5 h-3.5" /> Instagram
              </a>
            </li>
          </ul>
        </div>
        <div>
          <div className="micro mb-3">Reach us</div>
          {support && (
            <a
              href={`mailto:${support}`}
              className="inline-flex items-center gap-1.5 hover:text-[rgb(var(--text))]"
            >
              <Mail className="w-3.5 h-3.5" /> {support}
            </a>
          )}
        </div>
      </div>
      <div className="border-t border-[rgb(var(--border-c)/0.06)] py-4 text-center text-[11px] text-[rgb(var(--text-faint))]">
        © {new Date().getFullYear()} {brand}. The drop is real. The hair is
        real. The girl is you.
      </div>
    </footer>
  );
}

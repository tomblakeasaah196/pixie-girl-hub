import { Sparkles, HelpCircle } from "lucide-react";
import { useNavigation, useBranding, useSiteChrome, type FooterColumn } from "@/lib/site-config";
import { BrandLogo } from "@/components/site/BrandLogo";
import { SmartLink } from "@/components/site/SmartLink";
import { socialIcon } from "@/components/site/social-icons";
import { openHelp } from "@/lib/useStore";

// Fallback columns (used when Studio navigation isn't published yet).
const FALLBACK_COLUMNS: FooterColumn[] = [
  {
    title: "Shop",
    links: [
      { label: "All catalogue", url: "/shop" },
      { label: "Bundles", url: "/bundles" },
      { label: "Pixie Cuts", url: "/shop" },
      { label: "Bob Wigs", url: "/shop" },
      { label: "Curly Collection", url: "/shop" },
      { label: "Limited Drops", url: "/shop" },
    ],
  },
  {
    title: "Maison",
    links: [
      { label: "Our Story", url: "/about" },
      { label: "Journal", url: "/journal" },
      { label: "Services", url: "/services" },
    ],
  },
  {
    title: "Care",
    links: [
      { label: "Contact", url: "/contact" },
      { label: "Email Preferences", url: "/account" },
      { label: "Cancellation Policy", url: "/policies/cancellation" },
    ],
  },
];

export function SiteFooter() {
  const nav = useNavigation();
  const { name } = useBranding();
  const chrome = useSiteChrome();
  const columns =
    nav?.footer_columns && nav.footer_columns.length
      ? nav.footer_columns
      : FALLBACK_COLUMNS;
  const socials = nav?.socials ?? {};
  const socialEntries = Object.entries(socials).filter(([, href]) => href);

  return (
    <footer className="bg-ink border-t border-taupe/15 mt-32 rounded-t-lg">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-20 grid gap-12 md:grid-cols-4">
        <div>
          <BrandLogo
            imgClassName="w-[170px] h-auto max-h-12 object-contain select-none"
            fallback={
              <span className="font-display text-lg tracking-[0.28em] uppercase text-cream">
                {name || "Faitlyn Hair"}
              </span>
            }
          />
          <p className="mt-6 text-sm text-muted-foreground max-w-xs leading-relaxed">
            {chrome.footer.blurb}
          </p>
          {socialEntries.length ? (
            <div className="mt-6 flex gap-3">
              {socialEntries.map(([key, href]) => {
                const Icon = socialIcon(key);
                return (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={key}
                    className="grid h-9 w-9 place-items-center rounded-full border border-taupe/30 text-taupe hover:border-taupe hover:text-cream transition-colors"
                  >
                    <Icon size={15} />
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <h4 className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe mb-5">{col.title}</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {col.links.map((l, idx) => (
                <li key={`${l.label}-${idx}`} className="hover:text-cream transition-colors">
                  <SmartLink to={l.url}>{l.label}</SmartLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* Utility row — always present, independent of the Studio columns */}
      <div className="border-t border-taupe/15">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-6 lg:px-10 text-[0.65rem] tracking-[0.3em] uppercase text-taupe">
          <SmartLink
            to="/shade-finder"
            className="inline-flex items-center gap-2 transition-colors hover:text-cream"
          >
            <Sparkles size={14} strokeWidth={1.6} aria-hidden="true" /> Shop with AI
          </SmartLink>
          <button
            type="button"
            onClick={openHelp}
            className="inline-flex items-center gap-2 uppercase tracking-[0.3em] transition-colors hover:text-cream"
          >
            <HelpCircle size={14} strokeWidth={1.6} aria-hidden="true" /> Help center
          </button>
        </div>
      </div>
      <div className="border-t border-taupe/15 py-6 text-center text-[0.65rem] tracking-[0.35em] uppercase text-muted-foreground">
        © {new Date().getFullYear()} {chrome.footer.copyrightName || name || "Faitlyn Hair"} ·{" "}
        <span className="font-couture italic normal-case tracking-normal text-taupe text-sm">
          {chrome.footer.signature}
        </span>
      </div>
    </footer>
  );
}

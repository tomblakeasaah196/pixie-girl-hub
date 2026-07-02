import { Instagram, Facebook, Twitter, MessageCircle } from "lucide-react";
import { SITE_IMAGES } from "@/lib/site-assets";
import { useNavigation, type FooterColumn } from "@/lib/site-config";

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

const SOCIAL_ICON: Record<string, typeof Instagram> = {
  instagram: Instagram,
  facebook: Facebook,
  twitter: Twitter,
  whatsapp: MessageCircle,
};

export function SiteFooter({
  logoUrl = SITE_IMAGES.logoCream,
}: {
  logoUrl?: string;
} = {}) {
  const nav = useNavigation();
  const columns =
    nav?.footer_columns && nav.footer_columns.length
      ? nav.footer_columns
      : FALLBACK_COLUMNS;
  const socials = nav?.socials ?? {};
  const socialEntries = Object.entries(socials).filter(([, href]) => href);

  return (
    <footer className="bg-ink border-t border-taupe/15 mt-32">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-20 grid gap-12 md:grid-cols-4">
        <div>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Faitlyn Hair"
              width={709}
              height={274}
              className="w-[170px] h-auto max-h-12 object-contain select-none"
              draggable={false}
            />
          ) : (
            <span className="font-display text-lg tracking-[0.28em] uppercase text-cream">
              Faitlyn Hair
            </span>
          )}
          <p className="mt-6 text-sm text-muted-foreground max-w-xs leading-relaxed">
            A Lagos-born atelier of luxury natural hair. Curated, ethically sourced, finished by hand.
          </p>
          {socialEntries.length ? (
            <div className="mt-6 flex gap-3">
              {socialEntries.map(([key, href]) => {
                const Icon = SOCIAL_ICON[key] ?? Instagram;
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
                  <a href={l.url}>{l.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-taupe/15 py-6 text-center text-[0.65rem] tracking-[0.35em] uppercase text-muted-foreground">
        © {new Date().getFullYear()} Faitlyn Hair · <span className="font-couture italic normal-case tracking-normal text-taupe text-sm">Maison Faitlyn — fait à la main à Lagos</span>
      </div>
    </footer>
  );
}

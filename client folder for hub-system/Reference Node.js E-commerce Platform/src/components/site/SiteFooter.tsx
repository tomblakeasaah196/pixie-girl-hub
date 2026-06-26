import { Link } from "@tanstack/react-router";
import logoDark from "@/assets/faitlyn-logo-dark-mode.png.asset.json";

type FooterLink = { label: string; to?: string };

const columns: { h: string; l: FooterLink[] }[] = [
  {
    h: "Shop",
    l: [
      { label: "All catalogue", to: "/shop" },
      { label: "Bundles", to: "/bundles" },
      { label: "Pixie Cuts", to: "/shop" },
      { label: "Bob Wigs", to: "/shop" },
      { label: "Curly Collection", to: "/shop" },
      { label: "Limited Drops", to: "/shop" },
    ],
  },
  {
    h: "Maison",
    l: [
      { label: "Our Story", to: "/about" },
      { label: "Journal", to: "/journal" },
      { label: "Services", to: "/services" },
    ],
  },
  {
    h: "Care",
    l: [
      { label: "Contact", to: "/contact" },
      { label: "Email Preferences", to: "/preferences" },
      { label: "Cancellation Policy", to: "/policies/cancellation" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink border-t border-taupe/15 mt-32">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-20 grid gap-12 md:grid-cols-4">
        <div>
          <img
            src={logoDark.url}
            alt="Faitlyn Hair"
            width={709}
            height={274}
            className="w-[170px] h-auto max-h-12 object-contain select-none"
            draggable={false}
          />
          <p className="mt-6 text-sm text-muted-foreground max-w-xs leading-relaxed">
            A Lagos-born atelier of luxury natural hair. Curated, ethically sourced, finished by hand.
          </p>
        </div>
        {columns.map((c) => (
          <div key={c.h}>
            <h4 className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe mb-5">{c.h}</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {c.l.map((i) => (
                <li key={i.label} className="hover:text-cream transition-colors">
                  {i.to ? <Link to={i.to}>{i.label}</Link> : <span className="cursor-pointer">{i.label}</span>}
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

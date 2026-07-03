import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, Instagram, Search, Star } from "lucide-react";
import { publicApi, type DirectoryPartner } from "@/lib/api";

/**
 * Public certified-partner directory (§6.26): "the e-commerce site displays
 * the full list of trusted, vetted partners" — same data, dedicated page.
 * Public fields only; each card links to the live verify page.
 */
export const Route = createFileRoute("/stylists")({
  head: () => ({
    meta: [
      { title: "Certified stylists — Pixie Girl Partner Directory" },
      {
        name: "description",
        content:
          "Every stylist here is vetted, certified and verifiable. Find a trusted Pixie Girl partner near you.",
      },
    ],
  }),
  component: Directory,
});

function PartnerCard({ p }: { p: DirectoryPartner }) {
  return (
    <div className="glass rounded-xl2 p-6 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[19px] leading-tight">
            {p.display_name}
          </h3>
          <p className="text-[12px] text-cream-faint">
            {p.city}
            {p.state ? `, ${p.state}` : ""} · {p.country_code}
          </p>
        </div>
        {p.tier_label && (
          <span
            className="shrink-0 px-2.5 py-1 rounded-full text-[9.5px] font-bold tracking-[0.14em] uppercase border"
            style={{ borderColor: p.tier_color ?? "var(--accent)" }}
          >
            {p.tier_label}
          </span>
        )}
      </div>

      {p.rating_count > 0 ? (
        <p className="inline-flex items-center gap-1.5 text-[13px]">
          <Star className="w-4 h-4 text-warn" />
          {Number(p.avg_rating).toFixed(2)}
          <span className="text-cream-faint">
            · {p.rating_count} verified review{p.rating_count === 1 ? "" : "s"}
          </span>
        </p>
      ) : (
        <p className="text-[12px] text-cream-faint">Newly certified</p>
      )}

      {p.bio && (
        <p className="text-[13px] text-cream-muted leading-relaxed line-clamp-3">
          {p.bio}
        </p>
      )}

      <div className="mt-auto pt-2 flex items-center gap-2 flex-wrap">
        {p.badge_token && (
          <Link
            to="/verify/badge/$token"
            params={{ token: p.badge_token }}
            className="btn-ghost !py-2 !px-4 !text-[12px] no-underline"
          >
            <BadgeCheck className="w-3.5 h-3.5" /> Verify badge
          </Link>
        )}
        {p.instagram_url && (
          <a
            href={p.instagram_url}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost !py-2 !px-4 !text-[12px] no-underline"
          >
            <Instagram className="w-3.5 h-3.5" /> Instagram
          </a>
        )}
        {(p.website_url || p.portfolio_url) && (
          <a
            href={p.website_url ?? p.portfolio_url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost !py-2 !px-4 !text-[12px] no-underline"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Website
          </a>
        )}
      </div>
    </div>
  );
}

function Directory() {
  const [city, setCity] = useState("");
  const q = useQuery({
    queryKey: ["directory"],
    queryFn: () => publicApi.directory({}),
  });

  const rows = (q.data ?? []).filter(
    (p) =>
      !city ||
      p.city.toLowerCase().includes(city.toLowerCase()) ||
      (p.state ?? "").toLowerCase().includes(city.toLowerCase()) ||
      p.country_code.toLowerCase() === city.toLowerCase(),
  );

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <p className="micro mb-2">Partner directory</p>
      <h1 className="font-display text-[34px] mb-3">
        Certified. Vetted. Verifiable.
      </h1>
      <p className="text-[14px] text-cream-muted max-w-xl mb-8">
        Every stylist below passed identity and portfolio vetting and carries a
        live badge. Ratings come only from customers routed through Pixie —
        they cannot be gamed.
      </p>

      <div className="relative max-w-sm mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-cream-faint" />
        <input
          className="input !pl-11"
          placeholder="Search by city, state or country…"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </div>

      {q.isLoading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 rounded-xl2 bg-cream/5 animate-pulse" />
          ))}
        </div>
      )}
      {q.isError && (
        <div className="text-center py-20">
          <p className="text-danger text-[14px] mb-4">
            Couldn't load the directory.
          </p>
          <button className="btn-ghost" onClick={() => q.refetch()}>
            Try again
          </button>
        </div>
      )}
      {q.data && rows.length === 0 && (
        <div className="text-center py-20">
          <p className="font-display text-[22px] mb-2">
            No certified partners {city ? `near “${city}”` : "yet"}.
          </p>
          <p className="text-[13px] text-cream-muted mb-6">
            The network is growing — check back soon, or bring your own craft.
          </p>
          <Link to="/apply" className="btn-primary no-underline">
            Apply to partner
          </Link>
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((p) => (
          <PartnerCard key={p.partner_code} p={p} />
        ))}
      </div>
    </div>
  );
}

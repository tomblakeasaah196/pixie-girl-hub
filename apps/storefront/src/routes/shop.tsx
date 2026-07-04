import { createFileRoute, Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  getProducts,
  getCollections,
  getBundles,
  getShades,
  unwrap,
  priceFor,
  type ProductCard,
} from "@/lib/storefront";
import {
  askPraxisSearch,
  isQuotaError,
  type AiSearchResult,
  type AiSearchTurn,
} from "@/lib/ai-search";
import { ssrProducts } from "@/lib/server";
import { useCurrency } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";

// Optional (`?:`) fields, not `string | undefined`, so every existing
// bare `<Link to="/shop">` across the app keeps typechecking without having
// to pass a `search` prop it knows nothing about.
interface ShopSearch {
  q?: string;
  collection?: string;
  bundle?: string;
  shade?: string;
}

export const Route = createFileRoute("/shop")({
  head: () => ({ meta: [{ title: "Shop the Catalogue — Faitlyn Hair" }] }),
  loader: async () => ssrProducts({ data: { pageSize: 24 } }),
  validateSearch: (s: Record<string, unknown>): ShopSearch => ({
    q: typeof s.q === "string" ? s.q : undefined,
    collection: typeof s.collection === "string" ? s.collection : undefined,
    bundle: typeof s.bundle === "string" ? s.bundle : undefined,
    shade: typeof s.shade === "string" ? s.shade : undefined,
  }),
  component: Shop,
});

type ShopFilterKey = "collection" | "bundle" | "shade";

function Shop() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const initial = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/shop" });
  const [currency] = useCurrency();
  const [page, setPage] = useState(1);

  // Free-text draft: keystrokes update this instantly for a snappy input;
  // a debounced effect promotes it into the URL (and the live lexical
  // filter) so we don't fire a request on every keystroke. Any edit here
  // also drops out of Ask-Praxis mode, since a stale AI answer no longer
  // matches what's in the box.
  const [qDraft, setQDraft] = useState(search.q ?? "");
  useEffect(() => setQDraft(search.q ?? ""), [search.q]);
  useEffect(() => {
    const trimmed = qDraft.trim();
    if (trimmed === (search.q ?? "")) return;
    const id = setTimeout(() => {
      navigate({ search: (prev) => ({ ...prev, q: trimmed || undefined }), replace: true });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  const [ai, setAi] = useState<AiSearchResult | null>(null);
  const [aiHistory, setAiHistory] = useState<AiSearchTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const exitAiMode = () => {
    setAi(null);
    setAiHistory([]);
  };

  const setFilter = (key: ShopFilterKey, value: string) => {
    exitAiMode();
    navigate({ search: (prev) => ({ ...prev, [key]: value || undefined }), replace: true });
  };
  const hasFilters = Boolean(search.q || search.collection || search.bundle || search.shade);
  const clearFilters = () => {
    exitAiMode();
    setQDraft("");
    navigate({ search: {}, replace: true });
  };

  // Any change in the applied (not draft) lexical filters starts back at
  // page 1 — Ask Praxis results aren't paginated so this doesn't touch them.
  useEffect(() => {
    setPage(1);
  }, [search.q, search.collection, search.bundle, search.shade]);

  const { data: collections } = useQuery({
    queryKey: ["collections"],
    queryFn: () => getCollections(),
  });
  const { data: bundles } = useQuery({ queryKey: ["bundles"], queryFn: () => getBundles() });
  const { data: shades } = useQuery({ queryKey: ["shades"], queryFn: () => getShades() });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "products",
      initial.brand,
      page,
      search.q,
      search.collection,
      search.bundle,
      search.shade,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), page_size: "24" });
      if (search.q) qs.set("q", search.q);
      if (search.collection) qs.set("collection", search.collection);
      if (search.bundle) qs.set("bundle", search.bundle);
      if (search.shade) qs.set("shade", search.shade);
      return (unwrap(await getProducts(`?${qs.toString()}`)) as ProductCard[]) ?? [];
    },
    initialData: page === 1 && !hasFilters ? initial.products : undefined,
    placeholderData: keepPreviousData,
  });

  // Ask Praxis: a deliberate escalation (Enter / button, never per-keystroke)
  // to the Gemini-backed natural-language search. Overrides the grid with its
  // ranked picks until the shopper edits the box or picks a dropdown filter.
  const askPraxis = async () => {
    const question = qDraft.trim();
    if (!question || asking) return;
    setAsking(true);
    try {
      const result = await askPraxisSearch(question, aiHistory);
      setAi(result);
      setAiHistory((h) =>
        [...h, { role: "user" as const, content: question }, { role: "assistant" as const, content: result.message }].slice(-6),
      );
    } catch (err) {
      toast.error(
        isQuotaError(err)
          ? "You've used today's free Praxis searches — plain search still works below."
          : (err as { userMessage?: string })?.userMessage || "Praxis couldn't answer that — please try again.",
      );
    } finally {
      setAsking(false);
    }
  };

  const products = ai ? ai.products : (data ?? []);
  // The very first paint only — once any AI answer exists, swapping to a new
  // one never blanks the grid (keepPreviousData-style continuity).
  const showSkeleton = isLoading && !ai;
  const hasNext = !ai && products.length >= 24;
  const matchedChips = ai
    ? [
        ai.matched.collection ? `Collection: ${ai.matched.collection.name}` : null,
        ai.matched.bundle ? `Bundle: ${ai.matched.bundle.display_name}` : null,
        ai.matched.shade ? `Shade: ${ai.matched.shade.name}` : null,
      ].filter((x): x is string => Boolean(x))
    : [];

  // Scroll to top on catalogue page change (after the new page renders; not on
  // first mount). Runs in an effect so it fires regardless of async fetch timing.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  const goto = (p: number) => setPage(Math.max(1, p));
  const s = withSlots(
    {
      eyebrow: "The Catalogue",
      heading: "Shop the ",
      headingAccent: "maison",
      headingAfter: ".",
      body: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched.",
    },
    usePageSlots("shop"),
  );

  if (pathname !== "/shop" && pathname !== "/shop/") return <Outlet />;

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-32 lg:pt-36 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">{s.eyebrow}</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight">
            {s.heading}<em className="font-couture text-taupe">{s.headingAccent}</em>{s.headingAfter}
          </h1>
          <p className="mt-6 text-cream/70 leading-relaxed text-base md:text-lg">{s.body}</p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pb-8">
        <div className="border-y border-taupe/15 py-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex-1">
              <label htmlFor="shop-search" className="text-[0.65rem] tracking-[0.35em] uppercase text-taupe">
                Search
              </label>
              <div className="mt-2 flex items-center gap-3 border-b border-taupe/30 transition-colors focus-within:border-taupe">
                <input
                  id="shop-search"
                  type="search"
                  value={qDraft}
                  onChange={(e) => {
                    setQDraft(e.target.value);
                    if (ai) exitAiMode();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void askPraxis();
                    }
                  }}
                  placeholder={
                    aiHistory.length > 0
                      ? "Ask a follow-up — “something cheaper”, “warmer tones”…"
                      : "Search by name or colour — or ask, “what should I wear for a first date?”"
                  }
                  className="w-full bg-transparent py-2 text-cream placeholder:text-cream/35 outline-none"
                />
                <button
                  type="button"
                  onClick={() => void askPraxis()}
                  disabled={asking || !qDraft.trim()}
                  aria-label="Ask Praxis"
                  className="flex shrink-0 items-center gap-1.5 pb-2 text-[0.65rem] tracking-[0.3em] uppercase text-taupe transition-colors hover:text-cream disabled:opacity-30"
                >
                  {asking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Ask Praxis
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 sm:w-auto sm:shrink-0 sm:gap-6">
              <FilterSelect
                id="filter-collection"
                label="Collection"
                value={search.collection ?? ""}
                onChange={(v) => setFilter("collection", v)}
                placeholder="All"
                options={(collections ?? []).map((c) => ({ value: c.slug, label: c.name }))}
              />
              <FilterSelect
                id="filter-bundle"
                label="Bundle"
                value={search.bundle ?? ""}
                onChange={(v) => setFilter("bundle", v)}
                placeholder="All"
                options={(bundles ?? []).map((b) => ({ value: b.bundle_code, label: b.display_name }))}
              />
              <FilterSelect
                id="filter-shade"
                label="Shade"
                value={search.shade ?? ""}
                onChange={(v) => setFilter("shade", v)}
                placeholder="All"
                options={(shades ?? []).map((sh) => ({ value: sh.slug, label: sh.name }))}
              />
            </div>
          </div>

          {hasFilters && !ai ? (
            <div className="mt-4 flex items-center gap-4">
              <p className="text-[0.65rem] tracking-[0.3em] uppercase text-cream/50">
                {isFetching ? "Filtering…" : `${products.length} result${products.length === 1 ? "" : "s"}`}
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="text-[0.65rem] tracking-[0.3em] uppercase text-taupe underline underline-offset-4 transition-colors hover:text-cream"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>

        {ai ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 flex items-start gap-3 border border-rose/25 bg-rose/5 p-5 md:p-6"
          >
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-rose" />
            <div className="min-w-0 flex-1">
              <p className="text-[0.6rem] tracking-[0.35em] uppercase text-rose">Praxis</p>
              <p className="mt-2 leading-relaxed text-cream/85">{ai.message}</p>
              {ai.followup_question ? (
                <p className="mt-2 text-body-sm italic text-cream/60">{ai.followup_question}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-4">
                {matchedChips.map((label) => (
                  <span key={label} className="text-[0.6rem] tracking-[0.25em] uppercase text-taupe">
                    {label}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={exitAiMode}
                  className="text-[0.6rem] tracking-[0.3em] uppercase text-cream/50 underline underline-offset-4 transition-colors hover:text-cream"
                >
                  Back to browsing
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </section>

      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pb-32">
        {showSkeleton ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse bg-card" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="py-24 text-center text-cream/50">
            {ai
              ? "Praxis didn't find a match in the current catalogue — try rephrasing."
              : hasFilters
                ? "No products match your search."
                : "No products are available right now."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {products.map((p, i) => (
              <motion.div
                key={p.styled_id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: (i % 4) * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link to="/product/$slug" params={{ slug: p.slug }} className="group block">
                  <div className="aspect-[3/4] overflow-hidden bg-card">
                    {p.cover_image_url ? (
                      <img src={p.cover_image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105" />
                    ) : null}
                  </div>
                  <h3 className="mt-4 font-display text-lg group-hover:text-taupe transition-colors">{p.name}</h3>
                  <p className="mt-1 text-body-sm text-taupe">{priceFor(p, currency)}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        {products.length > 0 && !ai ? (
          <div className="mt-16 flex items-center justify-center gap-6">
            <button
              disabled={page === 1 || isFetching}
              onClick={() => goto(page - 1)}
              className="border border-taupe/40 px-6 py-3 text-[0.65rem] tracking-[0.35em] uppercase text-taupe transition-colors hover:bg-taupe/10 disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-[0.65rem] tracking-[0.35em] uppercase text-cream/60">
              Page {page}
            </span>
            <button
              disabled={!hasNext || isFetching}
              onClick={() => goto(page + 1)}
              className="border border-taupe/40 px-6 py-3 text-[0.65rem] tracking-[0.35em] uppercase text-taupe transition-colors hover:bg-taupe/10 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[0.65rem] tracking-[0.35em] uppercase text-taupe">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-line mt-2 text-cream"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

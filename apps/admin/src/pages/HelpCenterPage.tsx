import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  HelpCircle,
  Search,
  Sparkles,
  MessageSquare,
  ShoppingCart,
  Package,
  Wallet,
  ShieldCheck,
  BookOpen,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Card } from "@/components/ui/primitives";
import { helpApi, type HelpArticleSummary } from "@/lib/help-api";

/**
 * Help Center — DB-driven (PR 2).
 *
 * Lists categories + their articles, with a single search box. Praxis
 * reads the same article bodies via ai_knowledge_chunks, so what the
 * CEO sees here and what Praxis cites are the same source of truth.
 */

const ICONS: Record<string, typeof HelpCircle> = {
  Sparkles,
  MessageSquare,
  ShoppingCart,
  Package,
  Wallet,
  ShieldCheck,
  BookOpen,
  HelpCircle,
};

export function HelpCenterPage() {
  useBreadcrumbs([{ label: "Help Center" }]);
  const [q, setQ] = useState("");

  const categoriesQ = useQuery({
    queryKey: ["help", "categories"],
    queryFn: () => helpApi.listCategories(),
  });
  const articlesQ = useQuery({
    queryKey: ["help", "articles", q],
    queryFn: () => helpApi.listArticles({ q: q || undefined, limit: 200 }),
  });

  const byCategory = useMemo(() => {
    const m = new Map<string, HelpArticleSummary[]>();
    for (const a of articlesQ.data ?? []) {
      const key = a.category_slug ?? "other";
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return m;
  }, [articlesQ.data]);

  return (
    <div className="max-w-[980px] mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <HelpCircle className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">Help Center</h2>
          <p className="text-text-muted text-[13px]">
            Guides, FAQs, and the &ldquo;why&rdquo; behind how the Hub runs.
          </p>
        </div>
      </div>

      <div className="relative mt-5">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search guides — e.g. 'WhatsApp', 'costs', 'layaway'…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-panel-2 border hairline text-[13.5px] focus:outline-none focus:border-accent/40"
        />
      </div>

      <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-2.5 text-[12.5px] text-text-muted">
        <Sparkles className="w-4 h-4 mt-[2px] text-accent-glow shrink-0" />
        <div>
          <span className="text-text-primary font-medium">
            Try asking Praxis.
          </span>{" "}
          Every article here is indexed for Praxis AI, so you can ask
          questions in plain language like &ldquo;why can&rsquo;t my staff
          start a WhatsApp chat?&rdquo; and get a grounded answer.
        </div>
      </div>

      <div className="mt-7 space-y-7">
        {categoriesQ.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-panel-2 border hairline animate-pulse"
              />
            ))}
          </div>
        ) : (
          (categoriesQ.data ?? []).map((cat) => {
            const list = byCategory.get(cat.slug) ?? [];
            if (q && list.length === 0) return null;
            const Icon = (cat.icon && ICONS[cat.icon]) || BookOpen;
            return (
              <section key={cat.category_id}>
                <div className="flex items-center gap-2.5 mb-2.5">
                  <span className="grid place-items-center w-8 h-8 rounded-lg bg-panel-2 text-accent-glow border hairline">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="font-display text-[16px] font-medium leading-tight">
                      {cat.name}
                    </h3>
                    {cat.description && (
                      <p className="text-text-faint text-[12px] leading-tight">
                        {cat.description}
                      </p>
                    )}
                  </div>
                </div>
                {list.length === 0 ? (
                  <p className="text-text-faint text-[12.5px] italic ml-10">
                    No articles yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {list.map((a) => (
                      <Link key={a.article_id} to={`/help/${a.slug}`}>
                        <Card className="p-3.5 hover:border-accent/40 transition-colors h-full">
                          <div className="font-display text-[14.5px] leading-tight mb-1">
                            {a.title}
                          </div>
                          {a.summary && (
                            <p className="text-text-muted text-[12.5px] leading-relaxed line-clamp-2">
                              {a.summary}
                            </p>
                          )}
                          {a.tags?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {a.tags.slice(0, 3).map((t) => (
                                <span
                                  key={t}
                                  className="text-[10px] uppercase tracking-wider text-text-faint bg-panel-2 border hairline rounded-full px-1.5 py-[1px]"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

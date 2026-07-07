import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Sparkles, ExternalLink } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { helpApi } from "@/lib/help-api";
import { Markdown } from "@/components/help/Markdown";
import { MODULE_BY_KEY } from "@/lib/modules";

/**
 * An article's `related_module` is the module identity the content is about.
 * Most values are frontend module keys; a few legacy seeds use a different
 * name than the module key (e.g. Praxis Insights was seeded as `ai_insights`,
 * attendance content lives under HR). Resolve to the real route + label so the
 * "open module" chip always lands somewhere correct — including modules whose
 * route differs from their key (service_jobs → /service-jobs, campaigns →
 * /sales-campaigns, retail → /retail-partners).
 */
const RELATED_MODULE_ALIAS: Record<string, string> = {
  ai_insights: "insights",
  attendance: "hr",
};

function resolveRelatedModule(related: string): { to: string; label: string } {
  const key = RELATED_MODULE_ALIAS[related] ?? related;
  const mod = MODULE_BY_KEY[key];
  return { to: mod?.route ?? `/${related}`, label: mod?.label ?? related };
}

export function HelpArticlePage() {
  const { slug = "" } = useParams<{ slug: string }>();

  const q = useQuery({
    queryKey: ["help", "article", slug],
    queryFn: () => helpApi.getArticle(slug),
    enabled: !!slug,
  });

  useBreadcrumbs([
    { label: "Help Center", href: "/help" },
    { label: q.data?.title ?? "Article" },
  ]);

  if (q.isLoading) {
    return (
      <div className="max-w-[760px] space-y-3">
        <div className="h-6 bg-panel-2 rounded animate-pulse w-1/3" />
        <div className="h-10 bg-panel-2 rounded animate-pulse w-2/3" />
        <div className="h-40 bg-panel-2 rounded animate-pulse" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="max-w-[760px]">
        <Link
          to="/help"
          className="inline-flex items-center gap-1 text-[12.5px] text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to Help Center
        </Link>
        <h2 className="font-display text-[20px] font-medium">
          Article not found
        </h2>
        <p className="text-text-muted text-[13px] mt-2">
          The article you&rsquo;re looking for may have been moved or retired.
          Try the Help Center search.
        </p>
      </div>
    );
  }

  const a = q.data;

  return (
    <div className="max-w-[760px]">
      <Link
        to="/help"
        className="inline-flex items-center gap-1 text-[12.5px] text-text-muted hover:text-text-primary mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Help Center
      </Link>

      {a.category_name && (
        <div className="text-[11px] uppercase tracking-widest text-text-faint mb-1.5">
          {a.category_name}
        </div>
      )}
      <h1 className="font-display text-[28px] font-medium tracking-tight leading-tight">
        {a.title}
      </h1>
      {a.summary && (
        <p className="mt-2 text-text-muted text-[15px] leading-relaxed">
          {a.summary}
        </p>
      )}

      <div className="mt-4 mb-6 flex items-center gap-2 text-[11.5px] text-text-faint">
        {a.audience !== "all" && (
          <span className="uppercase tracking-widest border hairline rounded-full px-2 py-[1px]">
            For {a.audience}
          </span>
        )}
        {a.related_module &&
          (() => {
            const { to, label } = resolveRelatedModule(a.related_module);
            return (
              <Link
                to={to}
                className="uppercase tracking-widest border hairline rounded-full px-2 py-[1px] hover:border-accent/40 inline-flex items-center gap-1"
              >
                {label} <ExternalLink className="w-3 h-3" />
              </Link>
            );
          })()}
        <span className="ml-auto">
          Updated {new Date(a.updated_at).toLocaleDateString()}
        </span>
      </div>

      {/* Body */}
      <Markdown source={a.body_markdown} />

      {/* Praxis nudge */}
      <div className="mt-10 flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent/5 p-4">
        <Sparkles className="w-5 h-5 text-accent-glow shrink-0 mt-[2px]" />
        <div className="text-[13px] text-text-muted leading-relaxed">
          <span className="text-text-primary font-medium">
            Want to discuss this with Praxis?
          </span>{" "}
          Open Praxis AI and ask a follow-up. The agent has read this article
          and will quote it back in plain English.
        </div>
      </div>
    </div>
  );
}

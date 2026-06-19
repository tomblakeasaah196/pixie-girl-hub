import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Sparkles, ExternalLink } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { helpApi } from "@/lib/help-api";
import { Markdown } from "@/components/help/Markdown";

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
        {a.related_module && (
          <Link
            to={`/${a.related_module === "smartcomm" ? "smartcomm" : a.related_module}`}
            className="uppercase tracking-widest border hairline rounded-full px-2 py-[1px] hover:border-accent/40 inline-flex items-center gap-1"
          >
            {a.related_module} <ExternalLink className="w-3 h-3" />
          </Link>
        )}
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

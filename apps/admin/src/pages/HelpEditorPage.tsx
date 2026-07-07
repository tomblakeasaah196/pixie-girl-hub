import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Plus,
  Pencil,
  Archive,
  Sparkles,
  Save,
  X,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/lib/toast";
import { Button, Card, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { MODULES } from "@/lib/modules";
import {
  helpApi,
  type HelpArticleAdmin,
  type HelpCategory,
  type ArticleWriteInput,
} from "@/lib/help-api";

/**
 * Help Center Editor (PR3).
 *
 * DB-driven authoring for guides + FAQs. Every save re-syncs the article
 * into ai_knowledge_chunks on the backend, so Praxis is grounded in the
 * same text the moment it's written. Gated by the help_center edit
 * permission (the API enforces it too).
 */

const AUDIENCES = ["all", "ceo", "staff", "stylist"] as const;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const inputCls =
  "w-full px-3 py-2 rounded-lg bg-panel-2 border hairline text-[13.5px] focus:outline-none focus:border-accent/40";

export function HelpEditorPage() {
  useBreadcrumbs([
    { label: "Help Center", href: "/help" },
    { label: "Editor" },
  ]);
  const qc = useQueryClient();
  const toast = useToast("Help Center");
  const can = useAuthStore((s) => s.can);
  const canCreate = can("help_center", "create");
  const canDelete = can("help_center", "delete");

  const [filterCat, setFilterCat] = useState("");
  const [editing, setEditing] = useState<HelpArticleAdmin | null>(null);
  const [creating, setCreating] = useState(false);

  const categoriesQ = useQuery({
    queryKey: ["help", "admin", "categories"],
    queryFn: () => helpApi.admin.listCategories(),
  });
  const articlesQ = useQuery({
    queryKey: ["help", "admin", "articles"],
    queryFn: () => helpApi.admin.listArticles({ limit: 500 }),
  });

  const retire = useMutation({
    mutationFn: (id: string) => helpApi.admin.retireArticle(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["help"] });
      toast.success("Article retired", "It's hidden from readers and Praxis.");
    },
    onError: (e: unknown) =>
      toast.error("Could not retire", (e as Error)?.message),
  });

  const filtered = useMemo(() => {
    const list = articlesQ.data ?? [];
    return filterCat
      ? list.filter((a) => a.category_slug === filterCat)
      : list;
  }, [articlesQ.data, filterCat]);

  return (
    <div className="max-w-[980px] mx-auto">
      <Link
        to="/help"
        className="inline-flex items-center gap-1 text-[12.5px] text-text-muted hover:text-text-primary mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Help Center
      </Link>

      <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
        <div>
          <h2 className="font-display text-[22px] font-medium">
            Help Center Editor
          </h2>
          <p className="text-text-muted text-[13px]">
            Create and edit guides. Saving re-grounds Praxis in the same text.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setCreating(true)}
            icon={<Plus className="w-4 h-4" />}
          >
            New article
          </Button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className={inputCls + " max-w-[240px]"}
        >
          <option value="">All categories</option>
          {(categoriesQ.data ?? []).map((c) => (
            <option key={c.category_id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-text-faint text-[12px]">
          {filtered.length} article{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {articlesQ.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Plus className="w-6 h-6" />}
            title="No articles"
            message="Create the first guide for this area."
          />
        ) : (
          filtered.map((a) => (
            <Card key={a.article_id} className="p-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium truncate">
                    {a.title}
                  </span>
                  {a.category_name && (
                    <span className="text-[10px] uppercase tracking-wider text-text-faint bg-panel-2 border hairline rounded-full px-1.5 py-[1px]">
                      {a.category_name}
                    </span>
                  )}
                  {!a.is_active && (
                    <span className="text-[10px] uppercase tracking-wider text-warn border border-warn/40 rounded-full px-1.5 py-[1px]">
                      Retired
                    </span>
                  )}
                  {!a.praxis_indexed && (
                    <span className="text-[10px] uppercase tracking-wider text-text-faint border hairline rounded-full px-1.5 py-[1px]">
                      Not in Praxis
                    </span>
                  )}
                </div>
                <p className="text-text-faint text-[11.5px] mt-0.5 truncate">
                  {a.slug} · order {a.sort_order}
                  {a.related_module ? ` · ${a.related_module}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => setEditing(a)}
                icon={<Pencil className="w-3.5 h-3.5" />}
              >
                Edit
              </Button>
              {canDelete && a.is_active && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Retire "${a.title}"? It's hidden from readers and Praxis (the record is kept).`,
                      )
                    )
                      retire.mutate(a.article_id);
                  }}
                  icon={<Archive className="w-3.5 h-3.5" />}
                />
              )}
            </Card>
          ))
        )}
      </div>

      {(editing || creating) && (
        <ArticleModal
          article={editing ?? undefined}
          categories={categoriesQ.data ?? []}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            qc.invalidateQueries({ queryKey: ["help"] });
          }}
        />
      )}
    </div>
  );
}

function ArticleModal({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article?: HelpArticleAdmin;
  categories: HelpCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!article;
  const toast = useToast("Help Center → Article");

  // On edit we fetch the full row (body_markdown isn't in the list payload).
  const fullQ = useQuery({
    queryKey: ["help", "admin", "article", article?.article_id],
    queryFn: () => helpApi.admin.getArticle(article!.article_id),
    enabled: isEdit,
  });

  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [categorySlug, setCategorySlug] = useState(
    article?.category_slug ?? categories[0]?.slug ?? "",
  );
  const [relatedModule, setRelatedModule] = useState(
    article?.related_module ?? "",
  );
  const [audience, setAudience] = useState<HelpArticleAdmin["audience"]>(
    article?.audience ?? "all",
  );
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState((article?.tags ?? []).join(", "));
  const [sortOrder, setSortOrder] = useState<number>(article?.sort_order ?? 0);
  const [praxisIndexed, setPraxisIndexed] = useState(
    article?.praxis_indexed ?? true,
  );
  const [isActive, setIsActive] = useState(article?.is_active ?? true);
  const [bodyLoaded, setBodyLoaded] = useState(!isEdit);

  // Hydrate the body once the full article arrives (edit mode).
  if (isEdit && fullQ.data && !bodyLoaded) {
    setBody(fullQ.data.body_markdown ?? "");
    setBodyLoaded(true);
  }

  const save = useMutation({
    mutationFn: () => {
      const base: ArticleWriteInput = {
        title: title.trim(),
        summary: summary.trim() || null,
        body_markdown: body,
        audience,
        category_slug: categorySlug,
        related_module: relatedModule || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        sort_order: sortOrder,
        praxis_indexed: praxisIndexed,
        is_active: isActive,
      };
      return isEdit
        ? helpApi.admin.updateArticle(article!.article_id, base)
        : helpApi.admin.createArticle({ ...base, slug: slug || slugify(title) });
    },
    onSuccess: () => {
      toast.success(
        isEdit ? "Article saved" : "Article created",
        "Praxis has been re-grounded in the new text.",
      );
      onSaved();
    },
    onError: (e: unknown) => toast.error("Save failed", (e as Error)?.message),
  });

  const disabled =
    !title.trim() || !categorySlug || !body.trim() || (isEdit && !bodyLoaded);

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Edit article" : "New article"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} icon={<X className="w-4 h-4" />}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={disabled || save.isPending}
            icon={<Save className="w-4 h-4" />}
          >
            {isEdit ? "Save" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5 text-[13px]">
        <div className="flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-2.5 text-[12px] text-text-muted">
          <Sparkles className="w-4 h-4 mt-[1px] text-accent-glow shrink-0" />
          <span>
            Saving updates the guide for readers and re-grounds Praxis in the
            same text. Write in Markdown.
          </span>
        </div>

        <Field label="Title">
          <input
            className={inputCls}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!isEdit && !slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="e.g. Taking a Quick Sale" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </Field>

        {!isEdit && (
          <Field label="Slug (permanent id — lowercase, hyphens)">
            <input
              className={inputCls}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="taking-a-quick-sale" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Category">
            <select
              className={inputCls}
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.category_id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Related module (optional)">
            <select
              className={inputCls}
              value={relatedModule}
              onChange={(e) => setRelatedModule(e.target.value)}
            >
              <option value="">— none —</option>
              {MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Audience">
            <select
              className={inputCls}
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value as HelpArticleAdmin["audience"])
              }
            >
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort order">
            <input
              type="number"
              className={inputCls}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
        </div>

        <Field label="Summary (one line, shown on the card)">
          <input
            className={inputCls}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A short, plain-English summary." autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </Field>

        <Field label="Body (Markdown)">
          {isEdit && !bodyLoaded ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <textarea
              className={inputCls + " font-mono text-[12.5px] min-h-[260px]"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"## Heading\n\nExplain it plainly. Use - bullets and 1. steps."}
            />
          )}
        </Field>

        <Field label="Tags (comma-separated)">
          <input
            className={inputCls}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="sales, quick-sale, receipt" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </Field>

        <div className="flex items-center gap-5 pt-1">
          <label className="inline-flex items-center gap-2 cursor-pointer text-text-muted">
            <input
              type="checkbox"
              checked={praxisIndexed}
              onChange={(e) => setPraxisIndexed(e.target.checked)}
            />
            Index for Praxis
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer text-text-muted">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Published (visible)
          </label>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] uppercase tracking-wider text-text-faint mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

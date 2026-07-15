/**
 * Storefront Studio → Content.
 *
 * The no-jargon CMS for the shop's public words: FAQs, care guides, journal
 * posts and policies. Designed to be the easiest thing in the whole admin —
 * pick a kind, click New, type a title and the answer, hit Publish. Everything
 * technical (web address, reading time, SEO tags) is filled in for you.
 *
 * Published posts show on the storefront AND feed Praxis (the AI stylist), so
 * a shop owner grows what Praxis can talk about just by writing here. Drafts
 * stay private until published — which is exactly why Praxis never guesses.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  HelpCircle,
  Sparkles,
  Newspaper,
  ScrollText,
  Plus,
  Trash2,
  ExternalLink,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, Pill, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/controls";
import { toast } from "@/stores/toast";
import { describeError } from "@/lib/error-report";
import { uploadStorefrontImage, usePreviewInfo } from "@/lib/storefront-studio";
import {
  useContentPosts,
  useCreateContent,
  useUpdateContent,
  usePublishContent,
  useUnpublishContent,
  useDeleteContent,
  CONTENT_KINDS,
  FAQ_CATEGORIES,
  type ContentPost,
  type ContentKind,
  type ContentPostInput,
  type FaqCategory,
} from "@/lib/content-posts";
import { BlockEditor } from "./BlockEditor";

const AREA = "Storefront Studio → Content";

const inputCls =
  "w-full rounded-[10px] border border-line bg-text-primary/[0.04] px-3 py-2 text-[13px] text-text-primary outline-none transition focus:border-accent-deep";
const labelCls = "mb-1 block text-[12px] font-medium text-text-muted";

const KIND_ICON: Record<ContentKind, React.ReactNode> = {
  faq: <HelpCircle className="h-4 w-4" />,
  guide: <Sparkles className="h-4 w-4" />,
  journal: <Newspaper className="h-4 w-4" />,
  policy: <ScrollText className="h-4 w-4" />,
};

/** A blank in-memory draft for a new post of the given kind. */
function blankPost(kind: ContentKind): ContentPost {
  return {
    post_id: "",
    post_type: kind,
    slug: "",
    title: "",
    excerpt: null,
    body: null,
    hero_image_url: null,
    hero_image_alt: null,
    faq_category: kind === "faq" ? "general" : null,
    faq_question: null,
    tags: [],
    content_blocks: [],
    meta_title: null,
    meta_description: null,
    status: "draft",
    published_at: null,
    is_featured: false,
    display_order: 0,
    reading_time_minutes: null,
    updated_at: "",
  };
}

function toInput(p: ContentPost): ContentPostInput {
  return {
    post_type: p.post_type,
    title: p.title,
    slug: p.slug || undefined,
    excerpt: p.excerpt,
    body: p.body,
    hero_image_url: p.hero_image_url,
    hero_image_alt: p.hero_image_alt,
    faq_category: p.faq_category,
    faq_question: p.faq_question,
    tags: p.tags,
    content_blocks: p.content_blocks,
    is_featured: p.is_featured,
    display_order: p.display_order,
  };
}

/** Cross-tab handoff from Pages → journal, so clicking an article there opens
 *  it here without the operator having to re-find it. `postId` absent means
 *  "start a new journal post" instead of opening an existing one. */
export interface ContentJump {
  postId?: string;
}

export function ContentTab({
  jumpTo,
  onJumpHandled,
}: {
  jumpTo?: ContentJump | null;
  onJumpHandled?: () => void;
}) {
  const { data, isLoading } = useContentPosts();
  const create = useCreateContent();
  const update = useUpdateContent();
  const publish = usePublishContent();
  const unpublish = useUnpublishContent();
  const del = useDeleteContent();
  const { data: preview } = usePreviewInfo();

  const [kind, setKind] = useState<ContentKind>("faq");
  const [draft, setDraft] = useState<ContentPost | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const posts = useMemo(() => data || [], [data]);

  useEffect(() => {
    if (!jumpTo) return;
    setKind("journal");
    if (!jumpTo.postId) {
      setDraft(blankPost("journal"));
      onJumpHandled?.();
      return;
    }
    const found = posts.find((p) => p.post_id === jumpTo.postId);
    if (found) {
      setDraft({ ...found });
      onJumpHandled?.();
    }
    // else: posts haven't loaded yet — this effect re-runs once `posts` fills in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, posts]);
  const countByKind = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) c[p.post_type] = (c[p.post_type] || 0) + 1;
    return c;
  }, [posts]);
  const listed = useMemo(
    () => posts.filter((p) => p.post_type === kind),
    [posts, kind],
  );

  const meta = CONTENT_KINDS.find((k) => k.key === kind)!;
  const busy =
    create.isPending ||
    update.isPending ||
    publish.isPending ||
    unpublish.isPending;

  function selectKind(k: ContentKind) {
    setKind(k);
    setDraft(null);
  }
  function startNew() {
    setDraft(blankPost(kind));
  }
  function edit(p: ContentPost) {
    setDraft({ ...p });
  }

  // Persist the draft (create or update). Optionally publish right after, so
  // "Publish" is always a single click even for a brand-new post.
  async function save(opts: { thenPublish?: boolean } = {}) {
    if (!draft) return;
    const isFaq = draft.post_type === "faq";
    const titled =
      (draft.title && draft.title.trim()) ||
      (isFaq && draft.faq_question ? draft.faq_question.trim() : "");
    if (!titled) {
      toast.error(isFaq ? "Add a question first." : "Give it a title first.");
      return;
    }
    try {
      let saved: ContentPost;
      if (!draft.post_id) {
        saved = await create.mutateAsync(toInput(draft));
      } else {
        saved = await update.mutateAsync({
          postId: draft.post_id,
          input: toInput(draft),
        });
      }
      if (opts.thenPublish && saved.status !== "published") {
        saved = await publish.mutateAsync(saved.post_id);
        toast.success("Published — it's live now.");
      } else {
        toast.success(saved.status === "published" ? "Changes saved." : "Draft saved.");
      }
      setDraft(saved);
    } catch (e) {
      const { message, detail } = describeError(e);
      toast.error("Couldn't save", {
        description: message,
        report: { area: AREA, action: "Save content", message, detail },
      });
    }
  }

  async function doUnpublish() {
    if (!draft?.post_id) return;
    try {
      const saved = await unpublish.mutateAsync(draft.post_id);
      setDraft(saved);
      toast.success("Moved back to draft — hidden from the site.");
    } catch (e) {
      const { message, detail } = describeError(e);
      toast.error("Couldn't unpublish", {
        description: message,
        report: { area: AREA, action: "Unpublish content", message, detail },
      });
    }
  }

  async function doDelete() {
    if (!draft?.post_id) return;
    try {
      await del.mutateAsync(draft.post_id);
      toast.success("Deleted.");
      setDraft(null);
    } catch (e) {
      const { message, detail } = describeError(e);
      toast.error("Couldn't delete", {
        description: message,
        report: { area: AREA, action: "Delete content", message, detail },
      });
    } finally {
      setConfirmDel(false);
    }
  }

  const liveUrl =
    draft?.status === "published" && preview?.base_url && draft.slug
      ? draft.post_type === "policy"
        ? `${preview.base_url}/policies/${draft.slug}`
        : draft.post_type === "journal"
          ? `${preview.base_url}/journal/${draft.slug}`
          : null
      : null;

  return (
    <div className="space-y-5">
      {/* Kind picker — the whole navigation model, four friendly cards. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CONTENT_KINDS.map((k) => {
          const on = k.key === kind;
          return (
            <button
              key={k.key}
              onClick={() => selectKind(k.key)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-[14px] border p-3.5 text-left transition-all",
                on
                  ? "border-accent-deep bg-accent/[0.08] shadow-[0_6px_18px_rgb(var(--accent-deep)/0.25)]"
                  : "border-line bg-text-primary/[0.02] hover:bg-text-primary/[0.05]",
              )}
            >
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-[10px]",
                  on
                    ? "bg-accent-deep text-[#F4E9D9]"
                    : "bg-text-primary/[0.06] text-text-muted",
                )}
              >
                {KIND_ICON[k.key]}
              </span>
              <span className="text-[13px] font-semibold text-text-primary">
                {k.label}
              </span>
              <span className="text-[11px] text-text-muted">
                {countByKind[k.key] || 0} published or draft
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[12.5px] text-text-muted">{meta.blurb}</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* List of this kind */}
        <Card className="p-3">
          <Button
            variant="primary"
            size="sm"
            className="mb-3 w-full"
            icon={<Plus className="h-4 w-4" />}
            onClick={startNew}
          >
            New {meta.singular}
          </Button>
          {isLoading ? (
            <p className="px-2 py-3 text-[13px] text-text-muted">Loading…</p>
          ) : listed.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-text-muted">
              No {meta.label.toLowerCase()} yet. Click “New {meta.singular}”.
            </p>
          ) : (
            <ul className="space-y-1">
              {listed.map((p) => (
                <li key={p.post_id}>
                  <button
                    onClick={() => edit(p)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-[13px]",
                      draft?.post_id === p.post_id
                        ? "bg-text-primary/[0.07] text-text-primary"
                        : "text-text-muted hover:bg-text-primary/[0.04] hover:text-text-primary",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {p.title || "(untitled)"}
                    </span>
                    <Pill
                      tone={p.status === "published" ? "success" : "neutral"}
                      dot={false}
                    >
                      {p.status === "published" ? "Live" : "Draft"}
                    </Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Editor */}
        {draft ? (
          <Card className="max-w-2xl space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                {KIND_ICON[draft.post_type]}
                {draft.post_id ? `Edit ${meta.singular}` : `New ${meta.singular}`}
              </div>
              {draft.status === "published" ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4" /> Live on your site
                </span>
              ) : (
                <Pill tone="neutral" dot={false}>
                  Draft — not visible yet
                </Pill>
              )}
            </div>

            {draft.post_type === "faq" ? (
              <FaqFields draft={draft} setDraft={setDraft} />
            ) : (
              <ArticleFields draft={draft} setDraft={setDraft} />
            )}

            {liveUrl ? (
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12.5px] text-accent-glow hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View on your site
              </a>
            ) : null}

            {/* Actions — one obvious primary action. */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {draft.status === "published" ? (
                <>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => save()}
                  >
                    Save changes
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    icon={<EyeOff className="h-4 w-4" />}
                    onClick={doUnpublish}
                  >
                    Unpublish
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    disabled={busy}
                    icon={<Eye className="h-4 w-4" />}
                    onClick={() => save({ thenPublish: true })}
                  >
                    Publish
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => save()}
                  >
                    Save draft
                  </Button>
                </>
              )}
              {draft.post_id ? (
                <Button
                  variant="ghost"
                  disabled={busy || del.isPending}
                  className="ml-auto text-danger"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setConfirmDel(true)}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card className="grid place-items-center p-4">
            <EmptyState
              icon={<FileText className="h-7 w-7" />}
              title={`Write your first ${meta.singular}`}
              message={meta.blurb}
              action={
                <Button
                  variant="primary"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={startNew}
                >
                  New {meta.singular}
                </Button>
              }
            />
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={doDelete}
        title={`Delete this ${meta.singular}?`}
        message="This permanently removes it from your site and from Praxis. This can't be undone."
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </div>
  );
}

// ── Field groups ────────────────────────────────────────────

function FaqFields({
  draft,
  setDraft,
}: {
  draft: ContentPost;
  setDraft: (p: ContentPost) => void;
}) {
  return (
    <>
      <label className="block">
        <span className={labelCls}>Question shoppers ask</span>
        <input
          className={inputCls}
          value={draft.faq_question || ""}
          placeholder="How long does delivery take?"
          onChange={(e) =>
            setDraft({ ...draft, faq_question: e.target.value, title: e.target.value })
          } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </label>
      <label className="block">
        <span className={labelCls}>Topic</span>
        <select
          className={inputCls}
          value={draft.faq_category || "general"}
          onChange={(e) =>
            setDraft({ ...draft, faq_category: e.target.value as FaqCategory })
          }
        >
          {FAQ_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>Answer</span>
        <textarea
          className={cn(inputCls, "resize-y")}
          rows={5}
          value={draft.body || ""}
          placeholder="Write the answer exactly as you'd want Praxis to say it."
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        <span className="mt-1 block text-[11px] text-text-muted">
          Praxis quotes this word-for-word, so keep it accurate.
        </span>
      </label>
    </>
  );
}

function ArticleFields({
  draft,
  setDraft,
}: {
  draft: ContentPost;
  setDraft: (p: ContentPost) => void;
}) {
  const showHero = draft.post_type === "journal";
  const showFeatured = draft.post_type === "journal" || draft.post_type === "guide";
  const isJournal = draft.post_type === "journal";
  return (
    <>
      <label className="block">
        <span className={labelCls}>Title</span>
        <input
          className={inputCls}
          value={draft.title || ""}
          placeholder={
            draft.post_type === "policy" ? "Shipping Policy" : "Wash day, done right"
          }
          onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </label>
      <label className="block">
        <span className={labelCls}>Short summary (optional)</span>
        <input
          className={inputCls}
          value={draft.excerpt || ""}
          placeholder="One line shown on cards and in previews."
          onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </label>
      <label className="block">
        <span className={labelCls}>
          {isJournal ? "Plain-text summary (used by Praxis; shown only if the article below is empty)" : "Body"}
        </span>
        <textarea
          className={cn(inputCls, "resize-y")}
          rows={isJournal ? 4 : 10}
          value={draft.body || ""}
          placeholder={"Write in plain paragraphs. Leave a blank line between them."}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
      </label>
      {showHero ? (
        <HeroImage draft={draft} setDraft={setDraft} />
      ) : null}
      {isJournal ? (
        <label className="block">
          <span className={labelCls}>Category (optional)</span>
          <input
            className={inputCls}
            value={draft.tags?.[0] || ""}
            placeholder="e.g. AI Experience, Factory Story, Craftsmanship"
            onChange={(e) => {
              const v = e.target.value.trim();
              setDraft({ ...draft, tags: v ? [v, ...(draft.tags || []).slice(1)] : (draft.tags || []).slice(1) });
            }}
            autoComplete="off"
          />
          <span className="mt-1 block text-[11px] text-text-muted">
            Powers the filter tabs on the public Journal page.
          </span>
        </label>
      ) : null}
      {isJournal ? (
        <BlockEditor
          blocks={draft.content_blocks || []}
          onChange={(content_blocks) => setDraft({ ...draft, content_blocks })}
        />
      ) : null}
      {showFeatured ? (
        <button
          type="button"
          onClick={() => setDraft({ ...draft, is_featured: !draft.is_featured })}
          className="flex items-center justify-between py-1"
        >
          <span className="text-[13px] text-text-primary">
            Feature this {draft.post_type === "journal" ? "story" : "guide"}
          </span>
          <span
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              draft.is_featured ? "bg-accent-deep" : "bg-text-primary/15",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                draft.is_featured ? "left-[18px]" : "left-0.5",
              )}
            />
          </span>
        </button>
      ) : null}
    </>
  );
}

function HeroImage({
  draft,
  setDraft,
}: {
  draft: ContentPost;
  setDraft: (p: ContentPost) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadStorefrontImage(file);
      setDraft({ ...draft, hero_image_url: url });
      toast.success("Image uploaded.");
    } catch (e) {
      const { message, detail } = describeError(e);
      toast.error("Couldn't upload the image", {
        description: message,
        report: { area: AREA, action: "Upload hero image", message, detail },
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div>
      <span className={labelCls}>Cover image (optional)</span>
      <div className="flex items-start gap-2">
        <div className="grid h-[60px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-[8px] border border-line bg-text-primary/[0.04]">
          {draft.hero_image_url ? (
            <img
              src={draft.hero_image_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-[10px] text-text-muted">none</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Uploading…" : "Upload"}
          </Button>
          {draft.hero_image_url ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft({ ...draft, hero_image_url: null })}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

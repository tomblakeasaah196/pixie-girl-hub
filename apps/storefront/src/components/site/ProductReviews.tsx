import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { BadgeCheck, X } from "lucide-react";
import { bootstrapAuth } from "@/lib/auth";
import { getReviews, submitReview, type Review } from "@/lib/storefront";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { StarPicker, StarRow } from "@/components/site/Stars";

const STARS = [5, 4, 3, 2, 1] as const;

/** Rating summary + histogram + review list + gated "write a review" form.
 *  Reads/writes shared.product_reviews via the already-live storefront API —
 *  this component is the whole gap between that API and a visible section. */
export function ProductReviews({ slug }: { slug: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [summary, setSummary] = useState({
    count: 0,
    average: 0,
    breakdown: {} as Record<number, number>,
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const copy = withSlots(
    {
      reviewsHeading: "Customer Reviews",
      reviewsEmptyTitle: "Be the first to write a review",
      reviewsWriteCta: "Write a review",
      reviewsSignInPrompt: "Sign in to write a review",
      reviewsSignInCta: "Sign in",
      reviewsBasedOn: "based on",
      reviewsWord: "reviews",
      reviewsVerifiedBadge: "Verified purchase",
    },
    usePageSlots("product_detail"),
  );

  async function load() {
    try {
      const r = await getReviews(slug);
      setSummary(r.summary);
      setReviews(r.reviews);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    load();
    bootstrapAuth().then(setSignedIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (state === "loading") {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-6 w-48 rounded bg-secondary" />
        <div className="h-24 w-full rounded bg-secondary" />
      </div>
    );
  }
  // Reviews are supplementary to the purchase flow — fail quietly rather than
  // breaking the product page if the reviews call errors.
  if (state === "error") return null;

  const maxCount = Math.max(1, ...STARS.map((n) => summary.breakdown[n] || 0));

  return (
    <div>
      <h2 className="text-h4 font-display">{copy.reviewsHeading}</h2>

      <div className="mt-6 grid gap-10 md:grid-cols-[240px_1fr]">
        {/* Summary */}
        <div>
          {summary.count > 0 ? (
            <>
              <p className="font-mono text-h2">{summary.average.toFixed(1)}</p>
              <StarRow value={summary.average} size={18} />
              <p className="mt-1 text-caption text-muted-foreground">
                {copy.reviewsBasedOn} {summary.count} {copy.reviewsWord}
              </p>
              <div className="mt-4 space-y-1.5">
                {STARS.map((n) => (
                  <div key={n} className="flex items-center gap-2 text-body-sm">
                    <span className="w-3 text-muted-foreground">{n}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${((summary.breakdown[n] || 0) / maxCount) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-6 text-right text-muted-foreground">
                      {summary.breakdown[n] || 0}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-body text-muted-foreground">{copy.reviewsEmptyTitle}</p>
          )}

          <div className="mt-6">
            {signedIn ? (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="rounded-full border border-border px-5 py-2.5 text-body-sm transition hover:border-primary hover:bg-secondary"
              >
                {copy.reviewsWriteCta}
              </button>
            ) : signedIn === false ? (
              <p className="text-body-sm text-muted-foreground">
                {copy.reviewsSignInPrompt}{" "}
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  {copy.reviewsSignInCta}
                </Link>
              </p>
            ) : null}
          </div>
        </div>

        {/* List */}
        {reviews.length > 0 ? (
          <div className="space-y-6">
            {reviews.map((r) => (
              <div key={r.review_id} className="border-b border-border pb-6 last:border-none">
                <div className="flex items-center justify-between gap-4">
                  <StarRow value={r.rating} size={14} />
                  <span className="text-caption text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                {r.title ? <p className="mt-2 text-body font-medium">{r.title}</p> : null}
                {r.body ? (
                  <p className="mt-1 text-body-sm text-muted-foreground">{r.body}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-3 text-caption text-muted-foreground">
                  <span>{r.author}</span>
                  {r.is_verified_purchase ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <BadgeCheck className="h-3.5 w-3.5" />
                      {copy.reviewsVerifiedBadge}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {formOpen ? (
          <ReviewForm
            slug={slug}
            onClose={() => setFormOpen(false)}
            onSubmitted={() => {
              setFormOpen(false);
              load();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ReviewForm({
  slug,
  onClose,
  onSubmitted,
}: {
  slug: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Please choose a star rating.");
      return;
    }
    setBusy(true);
    try {
      const res = await submitReview({
        product_slug: slug,
        rating,
        title: title || undefined,
        body: body || undefined,
      });
      toast.success(res.message);
      onSubmitted();
    } catch (err) {
      toast.error(
        (err as { userMessage?: string })?.userMessage ||
          "Couldn't submit your review. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-x-4 bottom-4 z-[101] mx-auto max-w-lg rounded-md border border-border bg-card p-6 md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:w-[min(480px,92vw)] md:-translate-x-1/2 md:-translate-y-1/2"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground transition hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-h5 font-display">Write a review</h3>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <p className="text-caption text-muted-foreground">Your rating</p>
            <div className="mt-2">
              <StarPicker value={rating} onChange={setRating} size={26} />
            </div>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give your review a title (optional)"
            className="w-full rounded-md border border-border bg-transparent px-3 py-2.5 text-body-sm outline-none transition focus:border-primary"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Tell other customers about your experience"
            rows={4}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2.5 text-body-sm outline-none transition focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary px-6 py-3 text-body text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Submitting..." : "Submit review"}
          </button>
        </form>
      </motion.div>
    </>
  );
}

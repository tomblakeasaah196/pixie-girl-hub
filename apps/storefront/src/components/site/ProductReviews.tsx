import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { BadgeCheck, ImagePlus, X } from "lucide-react";
import { bootstrapAuth } from "@/lib/auth";
import {
  getReviews,
  submitReview,
  uploadReviewPhotos,
  type Review,
} from "@/lib/storefront";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { StarPicker, StarRow } from "@/components/site/Stars";
import { ImageLightbox } from "@/components/site/ImageLightbox";

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

  // One shared lightbox for every review's photos: hold the set + start index.
  const [photoView, setPhotoView] = useState<{
    photos: string[];
    start: number;
  } | null>(null);

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
  const hasReviews = summary.count > 0 || reviews.length > 0;

  // Shared write-CTA / sign-in prompt — same in the empty state and the
  // populated summary column, so it lives in one place.
  const writeCta = signedIn ? (
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
  ) : null;

  return (
    <div>
      <h2 className="text-h4 font-display">{copy.reviewsHeading}</h2>

      {!hasReviews ? (
        <div className="mt-6 flex flex-col items-center gap-5 py-10 text-center">
          <p className="text-body text-muted-foreground">{copy.reviewsEmptyTitle}</p>
          {writeCta}
        </div>
      ) : (
        <div className="mt-6 grid gap-10 md:grid-cols-[240px_1fr]">
          {/* Summary */}
          <div>
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
            <div className="mt-6">{writeCta}</div>
          </div>

          {/* List */}
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
                {r.photo_urls.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.photo_urls.map((url, i) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setPhotoView({ photos: r.photo_urls, start: i })}
                        aria-label="View review photo"
                        className="h-16 w-16 overflow-hidden rounded-md border border-border transition hover:border-primary"
                      >
                        <img
                          src={url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
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
        </div>
      )}

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
        {photoView ? (
          <ImageLightbox
            images={photoView.photos.map((url) => ({ url }))}
            startAt={photoView.start}
            onClose={() => setPhotoView(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const MAX_PHOTOS = 6;

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
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mirror the live previews in a ref so the unmount cleanup revokes whatever
  // is still selected at unmount (a `[]`-dep effect would capture the initial
  // empty set and leak any photos added afterwards).
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(
    () => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)),
    [],
  );

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error(`You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const picked = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, room)
      .map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...picked]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Please choose a star rating.");
      return;
    }
    setBusy(true);
    try {
      let photo_urls: string[] | undefined;
      if (photos.length > 0) {
        const uploaded = await uploadReviewPhotos(photos.map((p) => p.file));
        photo_urls = uploaded.photos.map((p) => p.url);
      }
      const res = await submitReview({
        product_slug: slug,
        rating,
        title: title || undefined,
        body: body || undefined,
        photo_urls,
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

          {/* Photos */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => addFiles(e.target.files)}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={p.preview} className="relative h-16 w-16">
                  <img
                    src={p.preview}
                    alt=""
                    className="h-full w-full rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label="Remove photo"
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-background text-foreground shadow ring-1 ring-border"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="grid h-16 w-16 place-items-center rounded-md border border-dashed border-border text-muted-foreground transition hover:border-primary hover:text-primary"
                  aria-label="Add photos"
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-caption text-muted-foreground">
              Add up to {MAX_PHOTOS} photos (optional)
            </p>
          </div>

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

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { Reveal } from "@/components/site/Reveal";
import { useAuth } from "@/lib/auth";

/**
 * Display-only reviews block.
 *  - Requires sign-in to submit (uses Supabase auth context).
 *  - Interactive 1–5 star rating.
 *  - Smooth thank-you state with reset.
 *
 * Persistence is intentionally out of scope here — submission resolves to a
 * thank-you state. Wire to a `reviews` table when the schema lands.
 */
export function CustomerReviews({ productSlug }: { productSlug?: string }) {
  const { user } = useAuth();
  const [writing, setWriting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);

  function reset() {
    setWriting(false);
    setSubmitted(false);
    setRating(0);
    setHover(0);
  }

  return (
    <section className="mx-auto max-w-[1100px] px-6 lg:px-10 py-20 md:py-28 border-t border-taupe/15">
      <Reveal className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <p className="text-caption text-rose mb-3">Customer reviews</p>
          <h2 className="text-h3">Be the first to write a review.</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 text-taupe/50" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="w-4 h-4" />
            ))}
          </div>
          {!writing && !submitted && (
            user ? (
              <button
                onClick={() => setWriting(true)}
                className="text-caption text-rose border-b border-rose/50 pb-0.5 hover:text-cream hover:border-cream/60 transition-colors"
              >
                Write a review →
              </button>
            ) : (
              <Link
                to="/auth"
                className="text-caption text-rose border-b border-rose/50 pb-0.5 hover:text-cream hover:border-cream/60 transition-colors"
              >
                Sign in to write a review →
              </Link>
            )
          )}
        </div>
      </Reveal>

      {writing && !submitted && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rating === 0) return;
            // TODO: persist via createServerFn -> public.reviews when schema lands.
            // productSlug + user.id + rating + body.
            void productSlug;
            setSubmitted(true);
          }}
          className="border border-taupe/20 p-6 md:p-8 grid gap-5 max-w-2xl animate-in fade-in duration-500"
        >
          <p className="text-caption text-taupe">
            Reviewing as <span className="text-cream/80">{user?.email}</span>
          </p>

          <div>
            <span className="text-caption text-taupe">Your rating</span>
            <div
              className="flex gap-1.5 mt-2"
              role="radiogroup"
              aria-label="Star rating"
              onMouseLeave={() => setHover(0)}
            >
              {[1, 2, 3, 4, 5].map((n) => {
                const active = (hover || rating) >= n;
                return (
                  <button
                    type="button"
                    key={n}
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    onMouseEnter={() => setHover(n)}
                    onClick={() => setRating(n)}
                    className="p-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-rose/60"
                  >
                    <Star
                      className={`w-7 h-7 transition-colors ${active ? "fill-rose text-rose" : "text-taupe/50"}`}
                    />
                  </button>
                );
              })}
            </div>
            {rating === 0 && (
              <p className="text-caption text-taupe/60 mt-2">Tap a star to rate this piece.</p>
            )}
          </div>

          <label className="block">
            <span className="text-caption text-taupe">Your review</span>
            <textarea
              required
              rows={4}
              maxLength={1000}
              className="input-line mt-2 resize-none"
              placeholder="How does it wear, feel, fit?"
            />
          </label>

          <div className="flex gap-3 mt-2">
            <button
              disabled={rating === 0}
              className="px-7 py-3 bg-taupe text-ink text-caption hover:bg-cream transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit review
            </button>
            <button
              type="button"
              onClick={reset}
              className="px-7 py-3 border border-taupe/30 text-taupe text-caption hover:border-taupe hover:text-cream transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {submitted && (
        <div className="max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="flex gap-1 mb-4 text-rose">
            {Array.from({ length: rating }).map((_, i) => (
              <Star key={i} className="w-5 h-5 fill-rose" />
            ))}
          </div>
          <p className="text-body-lg text-cream/85 border-l-2 border-rose pl-5 italic font-couture">
            Merci infiniment. Your review has been received — our concierge will publish it after a
            light read-through.
          </p>
          <button
            onClick={reset}
            className="mt-6 text-caption text-rose border-b border-rose/50 pb-0.5 hover:text-cream hover:border-cream/60 transition-colors"
          >
            Write another →
          </button>
        </div>
      )}
    </section>
  );
}

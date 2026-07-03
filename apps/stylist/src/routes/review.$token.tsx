import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Star } from "lucide-react";
import { publicApi, type ApiError } from "@/lib/api";

/**
 * Tokenised customer review (§6.26 Q14/Q15). Only platform-routed customers
 * hold this link; submitting confirms satisfaction and releases the
 * stylist's quality-hold immediately. noindex — the token is the only
 * intended discovery vector.
 */
export const Route = createFileRoute("/review/$token")({
  head: () => ({
    meta: [
      { title: "Rate your styling service — Pixie Girl" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { token } = Route.useParams();
  const ctx = useQuery({
    queryKey: ["review", token],
    queryFn: () => publicApi.reviewContext(token),
    retry: false,
  });
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [review, setReview] = useState("");
  const submit = useMutation({
    mutationFn: () => publicApi.submitReview(token, rating, review || undefined),
  });

  if (ctx.isLoading)
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <div className="glass rounded-xl2 p-8 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 rounded-lg bg-cream/5 animate-pulse" />
          ))}
        </div>
      </div>
    );

  if (ctx.isError)
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-[26px] mb-3">
          This review link isn't valid.
        </h1>
        <p className="text-[13.5px] text-cream-muted">
          It may have expired or already been used. If you believe that's
          wrong, reply to the email that brought you here.
        </p>
      </div>
    );

  const c = ctx.data!;

  if (c.already_reviewed || submit.isSuccess)
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <CheckCircle2 className="w-11 h-11 mx-auto text-success mb-4" />
        <h1 className="font-display text-[28px] mb-3">Thank you.</h1>
        <p className="text-[13.5px] text-cream-muted leading-relaxed mb-8">
          Your confirmation releases {c.stylist_name ?? "your stylist"}'s
          payment and your verified review joins their public profile. That's
          how trust works here.
        </p>
        <Link to="/stylists" className="btn-ghost no-underline">
          See certified stylists
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <div className="glass rounded-xl2 p-8">
        <p className="micro mb-2">Verified review · {c.assignment_number}</p>
        <h1 className="font-display text-[26px] leading-tight mb-2">
          How was your {c.service_key} with {c.stylist_name ?? "your stylist"}?
        </h1>
        <p className="text-[13px] text-cream-muted mb-7">
          Confirming you're happy releases their payment. Your rating is
          verified — only customers routed through Pixie can leave one.
        </p>

        <div
          className="flex gap-2 justify-center mb-6"
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onMouseEnter={() => setHover(n)}
              onClick={() => setRating(n)}
              className="p-1"
            >
              <Star
                className={`w-9 h-9 transition-colors ${
                  n <= (hover || rating)
                    ? "text-warn fill-[var(--warn)]"
                    : "text-cream/20"
                }`}
              />
            </button>
          ))}
        </div>

        <textarea
          className="input min-h-[110px] mb-5"
          placeholder="Anything you'd like other customers to know? (optional)"
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />

        <button
          className="btn-primary w-full"
          disabled={rating === 0 || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending
            ? "Sending…"
            : rating > 0
              ? `Confirm & send ${rating}★ review`
              : "Pick a rating first"}
        </button>
        {submit.isError && (
          <p className="text-danger text-[12.5px] mt-3 text-center">
            {(submit.error as ApiError).userMessage}
          </p>
        )}
      </div>
    </div>
  );
}

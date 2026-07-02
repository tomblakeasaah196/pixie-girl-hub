import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getService,
  requestBooking,
  fmt,
  type BookingInput,
} from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import { Section, LoadingGrid, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/services/$slug")({
  component: ServicePage,
});

const field =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm outline-none focus:border-primary";

function ServicePage() {
  const { slug } = Route.useParams();
  const [currency] = useCurrency();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["service", slug],
    queryFn: () => getService(slug),
  });

  const [form, setForm] = useState<BookingInput>({ full_name: "" });
  const set = (k: keyof BookingInput, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const booking = useMutation({
    mutationFn: () => {
      // Strict validator: only send non-empty fields (empty date/email 422s).
      const payload: BookingInput = { full_name: form.full_name.trim() };
      if (form.phone?.trim()) payload.phone = form.phone.trim();
      if (form.email?.trim()) payload.email = form.email.trim();
      if (form.preferred_date) payload.preferred_date = form.preferred_date;
      if (form.preferred_time?.trim()) payload.preferred_time = form.preferred_time.trim();
      if (form.notes?.trim()) payload.notes = form.notes.trim();
      return requestBooking(slug, payload);
    },
    onSuccess: (r) => {
      toast.success(r?.message || "Booking request sent. We'll be in touch.");
      setForm({ full_name: "" });
    },
    onError: () =>
      toast.error("Couldn't send your request. Please try again."),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    if (!form.phone && !form.email) {
      toast.error("Add a phone or email so we can reach you.");
      return;
    }
    booking.mutate();
  }

  if (isLoading)
    return (
      <Section>
        <LoadingGrid />
      </Section>
    );
  if (isError || !data)
    return (
      <Section>
        <ErrorState onRetry={() => refetch()} />
      </Section>
    );

  return (
    <Section>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <h1 className="text-h2 font-display">{data.name}</h1>
          <p className="mt-2 text-body-sm font-mono">
            {data.price_is_from ? "From " : ""}
            {fmt(
              currency === "USD" ? data.base_price_usd : data.base_price_ngn,
              currency,
            )}
            {data.duration_minutes ? ` - ${data.duration_minutes} min` : ""}
          </p>
          {data.long_description ? (
            <p className="mt-4 whitespace-pre-line text-body text-muted-foreground">
              {data.long_description}
            </p>
          ) : data.short_description ? (
            <p className="mt-4 text-body text-muted-foreground">
              {data.short_description}
            </p>
          ) : null}

          {data.whats_included && data.whats_included.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-h6 font-display">What's included</h2>
              <ul className="mt-2 list-disc pl-5 text-body-sm text-muted-foreground">
                {data.whats_included.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.faqs && data.faqs.length > 0 ? (
            <div className="mt-6 space-y-3">
              <h2 className="text-h6 font-display">FAQs</h2>
              {data.faqs.map((f, i) => (
                <div key={i}>
                  <p className="text-body-sm font-medium">{f.q}</p>
                  <p className="text-body-sm text-muted-foreground">{f.a}</p>
                </div>
              ))}
            </div>
          ) : null}

          {data.cancellation_policy ? (
            <p className="mt-6 text-body-sm text-muted-foreground">
              <span className="font-medium">Cancellation: </span>
              {data.cancellation_policy}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-6">
          <h2 className="text-h5 font-display">Request a booking</h2>
          {data.deposit_required ? (
            <p className="mt-1 text-body-sm text-muted-foreground">
              A deposit{data.deposit_pct ? ` (${data.deposit_pct}%)` : ""} may be
              required to confirm.
            </p>
          ) : null}
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              className={field}
              placeholder="Full name"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className={field}
                placeholder="Phone"
                value={form.phone || ""}
                onChange={(e) => set("phone", e.target.value)}
              />
              <input
                className={field}
                type="email"
                placeholder="Email"
                value={form.email || ""}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                className={field}
                type="date"
                value={form.preferred_date || ""}
                onChange={(e) => set("preferred_date", e.target.value)}
              />
              <input
                className={field}
                placeholder="Preferred time"
                value={form.preferred_time || ""}
                onChange={(e) => set("preferred_time", e.target.value)}
              />
            </div>
            <textarea
              className={field}
              rows={3}
              placeholder="Anything we should know?"
              value={form.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
            />
            <button
              type="submit"
              disabled={booking.isPending}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-body-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {booking.isPending ? "Sending..." : "Request booking"}
            </button>
          </form>
        </div>
      </div>
    </Section>
  );
}

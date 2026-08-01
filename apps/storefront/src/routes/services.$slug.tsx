import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import {
  getService,
  requestBooking,
  type BookingInput,
} from "@/lib/storefront";
import { formatFromNgn } from "@/lib/money";
import { useCurrency } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section, LoadingGrid, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/services/$slug")({
  component: ServicePage,
});

const field =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm outline-none focus:border-primary";

function ServicePage() {
  const { slug } = Route.useParams();
  const [currency] = useCurrency();
  // Shared copy for every service booking page (usePageSlots("service_detail")).
  const copy = withSlots(
    {
      backLabel: "← Services",
      fromPrefix: "From ",
      includedHeading: "What's included",
      faqsHeading: "FAQs",
      cancellationLabel: "Cancellation: ",
      successHeading: "Request received",
      // {name} → the service name.
      successBody:
        "Thank you — our team will reach out within 24 hours to confirm your {name} booking.",
      requestAnother: "Request another",
      bookingHeading: "Request a booking",
      // {pct} → " (X%)" when a deposit percentage is set, else empty.
      depositNote: "A deposit{pct} may be required to confirm.",
      fullNamePlaceholder: "Full name",
      phonePlaceholder: "Phone",
      emailPlaceholder: "Email",
      timePlaceholder: "Preferred time",
      notesPlaceholder: "Anything we should know?",
      sendingLabel: "Sending...",
      submitCta: "Request booking",
      sentToast: "Booking request sent. We'll be in touch.",
      errorToast: "Couldn't send your request. Please try again.",
      nameError: "Please enter your name.",
      contactError: "Add a phone or email so we can reach you.",
    },
    usePageSlots("service_detail"),
  );
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
      toast.success(r?.message || copy.sentToast);
      setForm({ full_name: "" });
    },
    onError: (err) =>
      toast.error(
        (err as { userMessage?: string })?.userMessage || copy.errorToast,
      ),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      toast.error(copy.nameError);
      return;
    }
    if (!form.phone && !form.email) {
      toast.error(copy.contactError);
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
      <Link
        to="/services"
        className="inline-flex items-center gap-2 text-[0.62rem] tracking-[0.4em] uppercase text-taupe hover:text-cream transition-colors"
      >
        {copy.backLabel}
      </Link>
      <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <h1 className="text-h2 font-display">{data.name}</h1>
          <p className="mt-2 text-body-sm font-mono">
            {data.price_is_from ? copy.fromPrefix : ""}
            {data.base_price_ngn != null
              ? formatFromNgn(Number(data.base_price_ngn), currency)
              : "-"}
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
              <h2 className="text-h6 font-display">{copy.includedHeading}</h2>
              <ul className="mt-2 list-disc pl-5 text-body-sm text-muted-foreground">
                {data.whats_included.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.faqs && data.faqs.length > 0 ? (
            <div className="mt-6 space-y-3">
              <h2 className="text-h6 font-display">{copy.faqsHeading}</h2>
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
              <span className="font-medium">{copy.cancellationLabel}</span>
              {data.cancellation_policy}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-6">
          {booking.isSuccess ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/50 text-primary">
                <Check size={22} />
              </div>
              <h2 className="text-h5 font-display">{copy.successHeading}</h2>
              <p className="mt-2 text-body-sm text-muted-foreground">
                {copy.successBody.replace("{name}", data.name)}
              </p>
              <button
                onClick={() => booking.reset()}
                className="mt-6 text-body-sm text-primary underline-offset-4 hover:underline"
              >
                {copy.requestAnother}
              </button>
            </div>
          ) : (
          <>
          <h2 className="text-h5 font-display">{copy.bookingHeading}</h2>
          {data.deposit_required ? (
            <p className="mt-1 text-body-sm text-muted-foreground">
              {copy.depositNote.replace(
                "{pct}",
                data.deposit_pct ? ` (${data.deposit_pct}%)` : "",
              )}
            </p>
          ) : null}
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              className={field}
              placeholder={copy.fullNamePlaceholder}
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className={field}
                placeholder={copy.phonePlaceholder}
                value={form.phone || ""}
                onChange={(e) => set("phone", e.target.value)}
              />
              <input
                className={field}
                type="email"
                placeholder={copy.emailPlaceholder}
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
                placeholder={copy.timePlaceholder}
                value={form.preferred_time || ""}
                onChange={(e) => set("preferred_time", e.target.value)}
              />
            </div>
            <textarea
              className={field}
              rows={3}
              placeholder={copy.notesPlaceholder}
              value={form.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
            />
            <button
              type="submit"
              disabled={booking.isPending}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-body-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {booking.isPending ? copy.sendingLabel : copy.submitCta}
            </button>
          </form>
          </>
          )}
        </div>
      </div>
    </Section>
  );
}

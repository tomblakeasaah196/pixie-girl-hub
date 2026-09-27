import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import {
  previewPayLink,
  createPayLinkCheckout,
  type PayLinkPreview,
} from "@/lib/storefront";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { formatCurrency } from "@/lib/money";
import { Section, ErrorState } from "@/components/parts";

/**
 * The permanent "pay any amount, anytime" page (§6.2). Every pay_url the
 * backend hands out — the order-placement email, layaway reminders,
 * abandoned-checkout nudges, invoicing, the sales-campaign checkout, and
 * Quick Sale/Quotations in the admin app — points at this exact route
 * (brand-urls.js payLinkUrl → `${base}/pay/${token}`). Until this file
 * existed the link 404'd everywhere it was sent, even though the backend
 * (`/api/public/pay/:token`) was already fully built for it.
 *
 * GET previews the balance; POST mints a gateway checkout for the chosen
 * amount and redirects there. The gateway's return_url_base is this same
 * page (payment-link.service.js), so on return we just re-fetch — no
 * separate "thank you" route needed.
 */

const ngn = (v: string | number | null | undefined) =>
  `₦${Number(v || 0).toLocaleString()}`;

export const Route = createFileRoute("/pay/$token")({ component: PayPage });

const DEFAULTS = {
  loading: "Loading your order…",
  eyebrow: "Payment",
  orderPrefix: "Order ",
  fullyPaidHeading: "Fully paid",
  fullyPaidBody: "Nothing further is owed on this order — thank you!",
  balanceLabel: "Outstanding balance",
  totalLabel: "Order total",
  paidLabel: "Paid so far",
  amountLabel: "Amount to pay",
  amountHint: "You can pay any amount up to the outstanding balance.",
  minNote: "Minimum payment on this plan: {min}",
  historyTitle: "Payment history",
  payCta: "Pay {amount}",
  paying: "Redirecting to secure payment…",
  invalidAmount: "Enter an amount between the plan minimum and the balance.",
  payError: "Couldn't start payment — please try again.",
  secureNote: "Secured checkout · you're never charged twice on a retry.",
};

function usePayCopy() {
  return withSlots(DEFAULTS, usePageSlots("pay_link"));
}

function PayPage() {
  const { token } = Route.useParams();
  const s = usePayCopy();
  const q = useQuery({
    queryKey: ["pay-link", token],
    queryFn: () => previewPayLink(token),
  });

  if (q.isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">{s.loading}</p>
      </Section>
    );
  if (q.isError || !q.data)
    return (
      <Section>
        <ErrorState onRetry={() => q.refetch()} />
      </Section>
    );

  return (
    <Section className="max-w-lg">
      <p className="text-caption">{s.eyebrow}</p>
      <h1 className="mt-2 text-h3 font-display">
        {s.orderPrefix}
        {q.data.order_number}
      </h1>
      <PayBody data={q.data} onPaid={() => q.refetch()} />
    </Section>
  );
}

function PayBody({
  data,
  onPaid,
}: {
  data: PayLinkPreview;
  onPaid: () => void;
}) {
  const { token } = Route.useParams();
  const s = usePayCopy();
  const outstanding = Number(data.outstanding_ngn) || 0;
  const minNext = Number(data.min_next_payment_ngn) || 0;
  // A USD order is paid in dollars: the balance and the amount box are in $
  // (the server's own figures — the $ the whole balance charges, the $ plan
  // minimum), converted to the order's locked ₦ rate only to call the API.
  const rate = Number(data.display_fx_rate) || 0;
  const usdOrder = data.outstanding_usd != null && rate > 0;
  const outstandingUsd = Number(data.outstanding_usd) || 0;
  const minNextUsd = Number(data.min_next_payment_usd) || 0;
  const due = usdOrder ? outstandingUsd : outstanding;
  const min = usdOrder ? minNextUsd : minNext;
  const money = (v: number | string) =>
    usdOrder ? formatCurrency(Number(v) || 0, "USD") : ngn(v);

  const [amount, setAmount] = useState(String(due || ""));
  // Reset the field to the fresh balance whenever the server data changes
  // (e.g. after a re-fetch on gateway return).
  useEffect(() => {
    setAmount(String(due || ""));
  }, [due]);

  const parsed = Number(amount) || 0;
  // ₦ to request: a $ amount at the order's locked rate. Paying the whole $
  // balance sends the exact ₦ balance, so the checkout charges the quoted $.
  const amountNgn = usdOrder
    ? parsed >= outstandingUsd || parsed * rate >= outstanding
      ? outstanding
      : Math.round(parsed * rate * 100) / 100
    : parsed;
  const chargeShown = usdOrder && amountNgn === outstanding ? outstandingUsd : parsed;

  const pay = useMutation({
    mutationFn: async () => {
      const res = await createPayLinkCheckout(token, {
        amount_ngn: amountNgn > 0 ? amountNgn : undefined,
      });
      return res;
    },
    onSuccess: (res) => {
      window.location.href = res.checkout_url;
    },
  });

  const amountValid = parsed > 0 && parsed >= min && parsed <= due;

  if (outstanding <= 0) {
    return (
      <div className="mt-6 rounded-md border border-border bg-secondary/40 p-5 text-center">
        <CheckCircle2 className="mx-auto text-gold" size={40} />
        <p className="mt-3 text-body font-display text-lg">
          {s.fullyPaidHeading}
        </p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {s.fullyPaidBody}
        </p>
        {data.payments.length > 0 && (
          <div className="mt-5 text-left">
            <PaymentHistory payments={data.payments} title={s.historyTitle} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <dl className="rounded-md border border-border p-4 space-y-2 text-body-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{s.totalLabel}</dt>
          <dd className="font-mono tabular-nums">
            {usdOrder
              ? money(
                  Number(data.amount_paid_ngn) > 0
                    ? Math.round((Number(data.total_ngn) / rate) * 100) / 100
                    : outstandingUsd,
                )
              : ngn(data.total_ngn)}
          </dd>
        </div>
        {Number(data.amount_paid_ngn) > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{s.paidLabel}</dt>
            <dd className="font-mono tabular-nums">
              {usdOrder
                ? money(
                    Math.round((Number(data.amount_paid_ngn) / rate) * 100) /
                      100,
                  )
                : ngn(data.amount_paid_ngn)}
            </dd>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-2 text-body font-medium">
          <dt>{s.balanceLabel}</dt>
          <dd className="font-mono tabular-nums">{money(due)}</dd>
        </div>
      </dl>

      <label className="block">
        <span className="mb-1.5 block text-caption text-muted-foreground">
          {s.amountLabel}
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={min || 0}
          max={due}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input-line text-body"
        />
        <span className="mt-1 block text-caption text-muted-foreground">
          {s.amountHint}
        </span>
        {min > 0 && min < due && (
          <span className="mt-0.5 block text-caption text-muted-foreground">
            {s.minNote.replace("{min}", money(min))}
          </span>
        )}
      </label>

      {pay.isError && (
        <p className="text-body-sm text-destructive">
          {(pay.error as { userMessage?: string })?.userMessage ||
            s.payError}
        </p>
      )}
      {!amountValid && amount !== "" && (
        <p className="text-body-sm text-destructive">{s.invalidAmount}</p>
      )}

      <button
        type="button"
        disabled={!amountValid || pay.isPending}
        onClick={() => pay.mutate()}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-body text-primary-foreground disabled:opacity-50"
      >
        {pay.isPending ? (
          <>
            <Loader2 size={16} className="animate-spin" /> {s.paying}
          </>
        ) : (
          <>
            <Lock size={16} />{" "}
            {s.payCta.replace("{amount}", money(chargeShown))}
          </>
        )}
      </button>

      <p className="text-center text-caption text-muted-foreground">
        {s.secureNote}
      </p>

      {data.payments.length > 0 && (
        <PaymentHistory payments={data.payments} title={s.historyTitle} />
      )}
    </div>
  );
}

function PaymentHistory({
  payments,
  title,
}: {
  payments: PayLinkPreview["payments"];
  title: string;
}) {
  const sorted = useMemo(
    () =>
      [...payments].sort(
        (a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime(),
      ),
    [payments],
  );
  return (
    <div className="border-t border-border pt-4">
      <p className="text-caption text-muted-foreground mb-2">{title}</p>
      <ul className="space-y-1.5">
        {sorted.map((p) => (
          <li
            key={p.payment_number}
            className="flex items-center justify-between text-body-sm"
          >
            <span className="text-muted-foreground">
              {new Date(p.paid_at).toLocaleDateString()} · {p.method}
            </span>
            <span className="font-mono tabular-nums">
              {p.paid_currency === "USD" && p.paid_amount != null
                ? formatCurrency(Number(p.paid_amount), "USD")
                : ngn(p.amount_ngn)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

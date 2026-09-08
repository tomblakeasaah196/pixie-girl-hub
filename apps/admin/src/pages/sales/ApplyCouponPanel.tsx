/**
 * ApplyCouponPanel — enter a discount code against an order that was already
 * placed (V2.2 §6.2 / §6.23.2).
 *
 * The gap it fills: a customer was eligible for a code — a loyalty voucher, a
 * campaign coupon, an apology discount — and nobody entered it at checkout. By
 * the time anyone notices, the order exists and a deposit has usually landed.
 * Cancelling and re-raising forfeits that deposit; Change Order deliberately
 * carries existing discounts forward rather than granting new ones. So the code
 * goes in here, next to where the money is taken.
 *
 * Two phases, deliberately. Check is read-only and shows what the code is
 * worth on THIS order before anything is written; Apply commits. Nobody should
 * discover the size of a discount by having already granted it.
 *
 * The waiver is capped at the outstanding balance (owner decision), so a code
 * worth more than the balance waives the balance and no more — the panel says
 * so plainly rather than letting the difference vanish silently.
 *
 * Rendered wherever payment is recorded: the order's Payments card, and the
 * Payments card on an order-backed invoice.
 */

import { useState } from "react";
import { TicketPercent, Check, AlertTriangle, Sparkles } from "lucide-react";
import { Button, MoneyText } from "@/components/ui/primitives";
import { Field, TextInput } from "@/components/ui/Form";
import { money } from "@/lib/format";
import { usePreviewOrderCoupon, useApplyOrderCoupon } from "./hooks";
import type { OrderCouponQuote, ApplyOrderCouponResult } from "./types";

interface Props {
  orderId: string;
  /** Hidden entirely when the order can't take a discount (nothing owed,
   *  cancelled, or the operator lacks sales.edit). */
  disabled?: boolean;
  /** Already-applied code, if any. An order holds one coupon, so the panel
   *  shows what it holds instead of an input. */
  appliedCode?: string | null;
  onApplied?: (result: ApplyOrderCouponResult) => void;
  /** Surface a failure through the host screen's toast as well as inline. */
  onError?: (message: string) => void;
}

export function ApplyCouponPanel({
  orderId,
  disabled,
  appliedCode,
  onApplied,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState<OrderCouponQuote | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = usePreviewOrderCoupon(orderId);
  const apply = useApplyOrderCoupon(orderId);

  // Typing invalidates the quote on screen — a figure computed for a different
  // code must never be the one sitting above the Apply button.
  //
  // Deliberately NOT upper-cased: codes are matched exactly as they were
  // minted, so forcing case here would make a lowercase code unfindable.
  const changeCode = (next: string) => {
    setCode(next);
    setQuote(null);
    setRejected(null);
    setError(null);
  };

  const reset = () => {
    setOpen(false);
    setCode("");
    setReason("");
    setQuote(null);
    setRejected(null);
    setError(null);
  };

  const handleCheck = async () => {
    const entered = code.trim();
    if (!entered) {
      setRejected("Enter a discount code.");
      return;
    }
    setError(null);
    setRejected(null);
    setQuote(null);
    try {
      const res = await preview.mutateAsync(entered);
      // An unusable code is a 200 with a sentence, not a throw — mistyping at
      // the counter is ordinary, and the reason belongs inline.
      if (res.valid) setQuote(res);
      else setRejected(res.message);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't check that code.";
      setError(msg);
    }
  };

  const handleApply = async () => {
    if (!quote) return;
    setError(null);
    try {
      const result = await apply.mutateAsync({
        coupon_code: quote.coupon_code,
        reason: reason.trim() || undefined,
      });
      reset();
      onApplied?.(result);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't apply that code.";
      setError(msg);
      onError?.(msg);
    }
  };

  // An order already carrying a code shows it rather than an input: the
  // backend holds one coupon per order, so offering a second is a dead end.
  if (appliedCode) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-[11px] border border-line bg-text-primary/[0.02] mb-3 text-[12px] text-text-muted">
        <TicketPercent className="w-3.5 h-3.5 shrink-0 text-accent" />
        <span>
          Discount code{" "}
          <span className="font-semibold text-text-primary">{appliedCode}</span>{" "}
          is already on this order. An order holds one code — use Change Order
          if the pricing needs to move again.
        </span>
      </div>
    );
  }

  if (disabled) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 mb-3 text-[12px] text-text-muted hover:text-accent transition-colors"
      >
        <TicketPercent className="w-3.5 h-3.5" />
        Apply a discount code
      </button>
    );
  }

  return (
    <div className="p-3 rounded-[11px] border border-line bg-text-primary/[0.02] mb-3">
      <div className="micro mb-3 flex items-center gap-1.5">
        <TicketPercent className="w-3.5 h-3.5" />
        Discount Code
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <Field label="Code" hint="reduces the balance owed">
            <TextInput
              value={code}
              onChange={(e) => changeCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCheck();
                }
              }}
              placeholder="e.g. WELCOME10"
              className="font-mono tracking-wide"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mb-[1px]"
          onClick={handleCheck}
          disabled={preview.isPending || !code.trim()}
        >
          {preview.isPending ? "Checking…" : "Check"}
        </Button>
      </div>

      {/* Code refused — the sentence comes from the server already written for
          the counter (expired, wrong customer, below minimum spend). */}
      {rejected && (
        <div className="flex items-start gap-2 mt-3 p-2.5 rounded-[10px] bg-warn/[0.08] border border-warn/20 text-[12px] text-warn">
          <AlertTriangle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          <span>{rejected}</span>
        </div>
      )}

      {/* The quote — what this code is worth here, before anything is written. */}
      {quote && (
        <div className="mt-3 p-3 rounded-[11px] bg-success/[0.06] border border-success/20">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] uppercase font-bold tracking-wide text-success">
                <Check className="w-3.5 h-3.5" />
                Code accepted
              </div>
              <div className="mt-1 text-[13px] font-semibold text-text-primary truncate">
                {quote.display_name}
              </div>
              {quote.description && (
                <div className="text-[11px] text-text-muted truncate">
                  {quote.description}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10.5px] uppercase tracking-wide font-bold text-text-muted">
                Waives
              </div>
              <MoneyText
                ngn={Number(quote.discount_ngn)}
                className="text-[22px] text-success"
              />
            </div>
          </div>

          {/* The cap bit: the code was worth more than was left to pay. Say it
              out loud — staff need to know before they tell the customer the
              code was "used". */}
          {quote.capped_to_balance && (
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-[10px] bg-warn/[0.08] border border-warn/20 text-[11.5px] text-warn">
              <AlertTriangle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
              <span>
                This code is worth {money(Number(quote.coupon_value_ngn))}, but
                only {money(Number(quote.balance_before_ngn))} is still owed —
                so it waives the balance and the remaining{" "}
                {money(Number(quote.capped_by_ngn ?? 0))} is not carried
                forward. Applying it marks the code used.
              </span>
            </div>
          )}

          {/* Before → after on both figures that matter. */}
          <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-success/20">
            <div>
              <div className="text-[10.5px] uppercase tracking-wide font-bold text-text-muted mb-1">
                Order total
              </div>
              <div className="text-[12px] text-text-muted">
                <span className="line-through">
                  {money(Number(quote.total_before_ngn))}
                </span>{" "}
                <span className="font-semibold text-text-primary">
                  → {money(Number(quote.total_after_ngn))}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wide font-bold text-text-muted mb-1">
                Balance due
              </div>
              <div className="text-[12px] text-text-muted">
                <span className="line-through">
                  {money(Number(quote.balance_before_ngn))}
                </span>{" "}
                <span className="font-semibold text-text-primary">
                  → {money(Number(quote.balance_after_ngn))}
                </span>
              </div>
            </div>
          </div>

          {/* The consequential case: this doesn't just reduce the balance, it
              closes the order — stock leaves, the Studio job opens, the
              invoice is marked paid. Warn before, not after. */}
          {quote.settles_order && (
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-[10px] bg-accent/[0.08] border border-accent/25 text-[11.5px] text-text-muted">
              <Sparkles className="w-3.5 h-3.5 mt-[1px] shrink-0 text-accent" />
              <span>
                This clears the balance, so the order settles the moment you
                apply it — stock is drawn, the invoice is marked paid and any
                Studio job opens, exactly as a final payment would.
              </span>
            </div>
          )}

          <div className="mt-3">
            <Field label="Why" hint="optional — kept on the order's audit trail">
              <TextInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. loyalty voucher, missed at checkout"
              />
            </Field>
          </div>

          <div className="flex gap-2 mt-3">
            <Button
              variant="primary"
              size="sm"
              onClick={handleApply}
              disabled={apply.isPending}
            >
              {apply.isPending
                ? "Applying…"
                : `Apply ${money(Number(quote.discount_ngn))}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-danger mt-3">{error}</p>}

      {!quote && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={reset}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

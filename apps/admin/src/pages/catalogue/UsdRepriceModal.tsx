import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  DollarSign,
  RefreshCw,
  Send,
  TrendingUp,
  Undo2,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { NumberField, Select } from "@/components/ui/controls";
import {
  useApplyUsdReprice,
  useDecideUsdRateChange,
  useUndoUsdReprice,
  useUsdPricing,
  useUsdRepricePreview,
  type UsdRateChangeRequest,
  type UsdRounding,
} from "@/lib/catalogue";
import { useAuthStore } from "@/stores/auth";

/**
 * "Apply USD exchange rate" (Catalogue → Config). The owner enters ONE
 * NGN-per-USD rate and every USD price in the catalogue is recomputed from its
 * NGN value — base variants, styled products, the size/lace/colour ladders,
 * bundles and this brand's services. A preview shows before → after; a soft
 * warning makes the overwrite explicit; a confirm box gates Apply; and the last
 * run can be undone (prior values are snapshotted server-side).
 *
 * The rate is what every dollar checkout converts at, so changing it is the
 * CEO's call: the CEO's Apply reprices at once, anyone else's Apply sends the
 * CEO an approval request (nothing changes until they approve). One request
 * waits at a time; only the CEO can undo.
 */
const ROUNDING_OPTIONS: { value: UsdRounding; label: string }[] = [
  { value: "exact", label: "Exact (2 decimals)" },
  { value: "whole", label: "Nearest whole $" },
  { value: "ninety_nine", label: "Charm price (.99)" },
];

const fmtNgn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString()}`;
const fmtUsd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${Number(n).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

export function UsdRepriceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const status = useUsdPricing();
  const preview = useUsdRepricePreview();
  const apply = useApplyUsdReprice();
  const undo = useUndoUsdReprice();
  const decide = useDecideUsdRateChange();
  const isCeo = useAuthStore((st) => st.user?.isCeo ?? false);
  const pending = status.data?.pending_request ?? null;

  const [rate, setRate] = useState("");
  const [rounding, setRounding] = useState<UsdRounding>("exact");
  const [confirm, setConfirm] = useState(false);

  const lastRate = status.data?.config?.usd_fx_rate ?? null;
  const marketRate = status.data?.market_rate ?? null;

  // Prefill the rate when the modal opens: last applied → market hint → blank.
  useEffect(() => {
    if (!open) return;
    setConfirm(false);
    apply.reset();
    preview.reset();
    decide.reset();
    setRate(
      lastRate != null
        ? String(lastRate)
        : marketRate != null
          ? String(Math.round(marketRate))
          : "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lastRate, marketRate]);

  const rateNum = Number(rate);
  const rateValid = rate.trim() !== "" && Number.isFinite(rateNum) && rateNum > 0;

  // The preview is "fresh" only while it matches the current rate + rounding;
  // changing either forces a re-preview (and clears the confirmation) so Apply
  // can never run on numbers the user hasn't seen.
  const previewFresh =
    preview.data != null &&
    preview.data.rate === rateNum &&
    preview.data.rounding === rounding;

  const counts = preview.data?.counts ?? status.data?.counts ?? null;
  const lastRun =
    status.data?.last_run && !status.data.last_run.is_undone
      ? status.data.last_run
      : null;

  const runPreview = () => {
    if (!rateValid) return;
    setConfirm(false);
    preview.mutate({ rate: rateNum, rounding });
  };

  const onChangeRate = (v: string) => {
    setRate(v);
    setConfirm(false);
  };
  const onChangeRounding = (v: UsdRounding) => {
    setRounding(v);
    setConfirm(false);
  };

  const doApply = () => {
    apply.mutate(
      { rate: rateNum, rounding },
      { onSuccess: () => setConfirm(false) },
    );
  };

  // What the last action produced: an applied reprice (the CEO's Apply, or the
  // CEO approving a request), or a request sent for approval.
  const applied =
    apply.data?.status === "applied"
      ? apply.data
      : decide.data?.status === "applied"
        ? decide.data
        : null;
  const requested = apply.data?.status === "pending_approval" ? apply.data : null;
  const rejected = decide.data?.status === "rejected";
  const appliedOk = !!(applied || requested || rejected);
  // A request is already waiting: nobody but the CEO (deciding it) can act.
  const blockedByPending = !!pending && !appliedOk;

  const footer = useMemo(
    () => (
      <>
        <Button variant="ghost" onClick={onClose}>
          {appliedOk ? "Done" : "Cancel"}
        </Button>
        {!appliedOk && !blockedByPending && (
          <Button
            variant="primary"
            icon={
              isCeo ? (
                <DollarSign className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )
            }
            disabled={!rateValid || !previewFresh || !confirm || apply.isPending}
            onClick={doApply}
          >
            {apply.isPending
              ? isCeo
                ? "Applying…"
                : "Sending…"
              : isCeo
                ? "Apply rate"
                : "Request approval"}
          </Button>
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appliedOk, blockedByPending, isCeo, rateValid, previewFresh, confirm, apply.isPending],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Apply USD exchange rate"
      footer={footer}
    >
      {applied ? (
        <AppliedPanel
          rowsChanged={applied.rows_changed}
          rate={applied.rate}
          canUndo={isCeo}
          onUndo={() => undo.mutate()}
          undoing={undo.isPending}
          undone={undo.isSuccess}
        />
      ) : requested ? (
        <RequestedPanel rate={requested.rate} />
      ) : rejected ? (
        <div className="py-2 text-[13px] text-text-muted flex items-center gap-2">
          <X className="w-4 h-4 text-danger" />
          Rate change rejected — nothing was changed.
        </div>
      ) : blockedByPending ? (
        <PendingPanel
          request={pending!}
          isCeo={isCeo}
          deciding={decide.isPending}
          failed={decide.isError}
          onDecide={(decision) =>
            decide.mutate({ instance_id: pending!.instance_id, decision })
          }
        />
      ) : (
        <div className="space-y-5">
          {/* Last applied banner */}
          {lastRun && (
            <div className="text-[12px] text-text-muted flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent-glow" />
              Last applied{" "}
              <span className="font-mono text-text-primary">
                ₦{Number(lastRun.rate).toLocaleString()}/$1
              </span>{" "}
              ·{" "}
              {formatDate(lastRun.applied_at)}
              {lastRun.applied_by_email ? ` · ${lastRun.applied_by_email}` : ""}
            </div>
          )}

          {/* Rate + rounding */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[200px]">
              <label className="micro block mb-1">Exchange rate (₦ per $1)</label>
              <NumberField
                value={rate}
                onChange={onChangeRate}
                suffix="₦"
                placeholder="e.g. 1650"
              />
            </div>
            <div className="w-[200px]">
              <label className="micro block mb-1">Rounding</label>
              <Select
                value={rounding}
                onChange={onChangeRounding}
                options={ROUNDING_OPTIONS}
              />
            </div>
            <Button
              variant="secondary"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              disabled={!rateValid || preview.isPending}
              onClick={runPreview}
            >
              {preview.isPending ? "Calculating…" : "Preview"}
            </Button>
          </div>

          {/* Market-rate hint */}
          {marketRate != null && (
            <div className="text-[12px] text-text-faint">
              Market today ≈{" "}
              <button
                type="button"
                className="font-mono text-accent-glow hover:underline"
                onClick={() => onChangeRate(String(Math.round(marketRate)))}
              >
                ₦{Number(marketRate).toLocaleString()}/$1
              </button>{" "}
              — tap to use. (Informational; your prices stay manual.)
            </div>
          )}

          {/* Soft warning — overwrite all + services note */}
          <div className="rounded-[12px] border border-warn/30 bg-warn/[0.06] p-3.5 flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
            <div className="text-[12.5px] text-text-muted space-y-1">
              <p>
                This <strong>overwrites every USD price</strong> in the
                catalogue from its Naira value — including any you set by hand.
              </p>
              <p className="text-[11.5px] text-text-faint">
                Scope: base variants, styled products, the size / lace / colour
                ladders, bundles, and this brand’s services. You can undo the
                last apply.
              </p>
            </div>
          </div>

          {/* Counts */}
          {counts && (
            <div className="text-[12.5px] text-text-muted">
              <span className="font-display text-text-primary text-[15px]">
                {counts.total.toLocaleString()}
              </span>{" "}
              USD price fields will be recomputed
              {previewFresh
                ? ` at ₦${rateNum.toLocaleString()}/$1.`
                : " — preview to see the new figures."}
            </div>
          )}

          {/* Preview sample */}
          {previewFresh && preview.data!.sample.length > 0 && (
            <div className="rounded-[12px] border border-line overflow-hidden">
              <div className="px-3.5 py-2 text-[11px] text-text-faint border-b hairline">
                Sample — new USD retail at this rate
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-[12.5px]">
                  <tbody>
                    {preview.data!.sample.map((s, i) => (
                      <tr key={i} className="border-b hairline last:border-0">
                        <td className="px-3.5 py-2 truncate max-w-[260px]">
                          {s.name}
                        </td>
                        <td className="px-2 py-2 text-right text-text-muted">
                          {fmtNgn(s.ngn)}
                        </td>
                        <td className="px-2 py-2 text-center text-text-faint">→</td>
                        <td className="px-3.5 py-2 text-right">
                          <span className="font-display text-text-primary">
                            {fmtUsd(s.new_usd)}
                          </span>
                          {s.current_usd != null &&
                            s.current_usd !== s.new_usd && (
                              <span className="block font-mono text-[10px] text-text-faint line-through">
                                {fmtUsd(s.current_usd)}
                              </span>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.isError && (
            <p className="text-[12.5px] text-danger">
              Couldn’t build the preview. Check the rate and try again.
            </p>
          )}

          {/* Confirm gate */}
          <label
            className={`flex items-start gap-2.5 rounded-[11px] border p-3 cursor-pointer transition-colors ${
              confirm ? "border-accent/50 bg-accent/[0.05]" : "border-line"
            } ${!previewFresh ? "opacity-50 pointer-events-none" : ""}`}
          >
            <input
              type="checkbox"
              checked={confirm}
              disabled={!previewFresh}
              onChange={(e) => setConfirm(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)] w-4 h-4"
            />
            <span className="text-[12.5px] text-text-muted">
              I understand this overwrites <strong>all</strong> USD prices across
              the catalogue, and have reviewed the preview.
              {!isCeo && (
                <span className="block text-[11.5px] text-text-faint mt-0.5">
                  The CEO approves rate changes — this sends them the request;
                  nothing changes until they approve.
                </span>
              )}
            </span>
          </label>

          {apply.isError && (
            <p className="text-[12.5px] text-danger">
              The reprice failed and nothing was changed. Please try again.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** The request is with the CEO — nothing has changed yet. */
function RequestedPanel({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="grid place-items-center w-11 h-11 rounded-full bg-info/15 text-info shrink-0">
        <Send className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-display text-[16px]">Sent to the CEO for approval</h3>
        <p className="text-[12.5px] text-text-muted">
          <span className="font-mono">₦{Number(rate).toLocaleString()}/$1</span>{" "}
          is waiting for approval. Prices and dollar checkouts don’t change until
          it’s approved.
        </p>
      </div>
    </div>
  );
}

/** A rate change is waiting: the CEO decides it here; anyone else waits. */
function PendingPanel({
  request,
  isCeo,
  deciding,
  failed,
  onDecide,
}: {
  request: UsdRateChangeRequest;
  isCeo: boolean;
  deciding: boolean;
  failed: boolean;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  return (
    <div className="space-y-4 py-1">
      <div className="rounded-[12px] border border-info/30 bg-info/[0.06] p-3.5 flex gap-2.5">
        <Clock className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <div className="text-[12.5px] text-text-muted space-y-1">
          <p>
            <span className="font-mono text-text-primary">
              ₦{Number(request.rate).toLocaleString()}/$1
            </span>{" "}
            was requested
            {request.requested_by_email ? ` by ${request.requested_by_email}` : ""} on{" "}
            {formatDate(request.requested_at)}
            {request.current_rate != null
              ? ` (now ₦${Number(request.current_rate).toLocaleString()}/$1)`
              : ""}
            .
          </p>
          <p className="text-[11.5px] text-text-faint">
            {isCeo
              ? "Approving reprices every USD price in the catalogue at this rate and makes it the rate dollar checkouts convert at."
              : "It’s waiting for the CEO. Another change can’t be requested until this one is approved or rejected."}
          </p>
        </div>
      </div>
      {isCeo && (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            icon={<Check className="w-4 h-4" />}
            disabled={deciding}
            onClick={() => onDecide("approve")}
          >
            {deciding ? "Working…" : "Approve & apply"}
          </Button>
          <Button
            variant="ghost"
            icon={<X className="w-4 h-4" />}
            disabled={deciding}
            onClick={() => onDecide("reject")}
          >
            Reject
          </Button>
        </div>
      )}
      {failed && (
        <p className="text-[12.5px] text-danger">
          That didn’t go through and nothing was changed. Please try again.
        </p>
      )}
    </div>
  );
}

function AppliedPanel({
  rowsChanged,
  rate,
  canUndo,
  onUndo,
  undoing,
  undone,
}: {
  rowsChanged: number;
  rate: number;
  canUndo: boolean;
  onUndo: () => void;
  undoing: boolean;
  undone: boolean;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-3">
        <div className="grid place-items-center w-11 h-11 rounded-full bg-success/15 text-success shrink-0">
          <Check className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-display text-[16px]">USD prices updated</h3>
          <p className="text-[12.5px] text-text-muted">
            {rowsChanged.toLocaleString()} price field
            {rowsChanged === 1 ? "" : "s"} recomputed at{" "}
            <span className="font-mono">₦{Number(rate).toLocaleString()}/$1</span>
            .
          </p>
        </div>
      </div>

      {undone ? (
        <div className="rounded-[11px] border border-line p-3 text-[12.5px] text-text-muted flex items-center gap-2">
          <Undo2 className="w-4 h-4 text-accent-glow" />
          Reverted — USD prices restored to their previous values.
        </div>
      ) : canUndo ? (
        <div className="rounded-[11px] border border-line p-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-text-muted">
            Changed your mind? Restore the previous USD prices.
          </span>
          <Button
            variant="secondary"
            icon={<Undo2 className="w-3.5 h-3.5" />}
            disabled={undoing}
            onClick={onUndo}
          >
            {undoing ? "Undoing…" : "Undo this apply"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

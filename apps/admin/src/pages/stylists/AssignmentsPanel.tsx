/**
 * Assignments — the offer-pool router (§6.26). Ops sees every routed job,
 * the ranked suggest drawer (Q13: nearest → tier/rating/capacity/specialty),
 * offers with match scores, quality-hold state (Q14) and disputes.
 */

import { useState } from "react";
import { Compass, Route } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, ConfirmDialog } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import {
  useAssignments,
  useAssignment,
  useAssignmentMutations,
  useRoutingSuggest,
} from "./hooks";
import { ASSIGNMENT_STATUS_META } from "./constants";
import type { Assignment } from "./types";

function holdState(a: Assignment): { label: string; tone: "success" | "warn" | "danger" | "neutral" } {
  if (a.status !== "completed") return { label: "—", tone: "neutral" };
  if (a.disputed_at && !a.dispute_resolved_at)
    return { label: "Frozen (dispute)", tone: "danger" };
  if (a.payout_id) return { label: "Paid out", tone: "success" };
  if (a.satisfaction_confirmed_at)
    return { label: "Confirmed — payable", tone: "success" };
  if (a.payable_at && new Date(a.payable_at) <= new Date())
    return { label: "Window lapsed — payable", tone: "success" };
  if (a.payable_at)
    return {
      label: `On hold to ${new Date(a.payable_at).toLocaleDateString()}`,
      tone: "warn",
    };
  return { label: "On hold", tone: "warn" };
}

function SuggestDrawer({
  assignmentId,
  serviceKey,
  onClose,
}: {
  assignmentId: string;
  serviceKey: string;
  onClose: () => void;
}) {
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("NG");
  const suggest = useRoutingSuggest({
    service_key: serviceKey,
    city: city || undefined,
    country_code: country || undefined,
  });
  const { addOffers } = useAssignmentMutations(assignmentId);
  const [picked, setPicked] = useState<string[]>([]);
  const topN = suggest.data?.offer_top_n ?? 3;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Routing suggestions"
      subtitle="Nearest first, weighted by tier · rating · availability · specialty — the human offers, the engine ranks"
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            className="input h-9 w-40"
            placeholder="Customer city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <input
            className="input h-9 w-20 font-mono uppercase"
            maxLength={3}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </div>

        {suggest.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-text-primary/[0.05] animate-pulse" />
            ))}
          </div>
        )}
        {suggest.isError && (
          <ErrorState
            message={(suggest.error as Error).message}
            onRetry={() => suggest.refetch()}
          />
        )}
        {suggest.data && suggest.data.candidates.length === 0 && (
          <p className="text-[12.5px] text-text-faint py-8 text-center">
            No eligible certified partners with open capacity match this job.
          </p>
        )}
        {(suggest.data?.candidates ?? []).map((c) => {
          const checked = picked.includes(c.stylist_id);
          return (
            <button
              key={c.stylist_id}
              onClick={() =>
                setPicked((p) =>
                  checked
                    ? p.filter((x) => x !== c.stylist_id)
                    : [...p, c.stylist_id],
                )
              }
              className={`w-full text-left glass rounded-xl p-3 border transition-colors ${
                checked ? "border-accent/60" : "border-transparent hover:border-line"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-[13px] font-semibold">
                    #{c.match_rank} {c.display_name}
                  </span>
                  <span className="text-[11.5px] text-text-faint ml-2">
                    {c.city} · {c.current_tier_key ?? "no tier"} ·{" "}
                    {c.rating_count > 0
                      ? `${Number(c.avg_rating).toFixed(1)}★`
                      : "unrated"}{" "}
                    · {c.current_active_count}/{c.max_active_assignments} busy
                    {!c.has_specialty && " · no matching specialty"}
                  </span>
                </div>
                <span className="font-display text-[18px] tabular-nums">
                  {c.match_score}
                </span>
              </div>
              {c.rate && (
                <div className="text-[11.5px] text-text-muted mt-1">
                  Rate: <MoneyText ngn={Number(c.rate)} className="text-[11.5px]" />
                </div>
              )}
            </button>
          );
        })}

        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={!picked.length || addOffers.isPending}
            onClick={() => addOffers.mutate(picked, { onSuccess: onClose })}
          >
            Offer to {picked.length || "…"} selected
          </Button>
          {suggest.data && (
            <Button
              variant="secondary"
              disabled={addOffers.isPending || !suggest.data.candidates.length}
              onClick={() =>
                addOffers.mutate(
                  suggest.data!.candidates.slice(0, topN).map((c) => c.stylist_id),
                  { onSuccess: onClose },
                )
              }
            >
              One-click top {topN}
            </Button>
          )}
        </div>
        {addOffers.isError && (
          <p className="text-danger text-[12px]">
            {(addOffers.error as Error).message}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function AssignmentDrawer({
  assignmentId,
  onClose,
}: {
  assignmentId: string;
  onClose: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const detail = useAssignment(assignmentId);
  const m = useAssignmentMutations(assignmentId);
  const [suggesting, setSuggesting] = useState(false);
  const [disputing, setDisputing] = useState<null | "open" | "resolve">(null);
  const [disputeText, setDisputeText] = useState("");
  const [outcome, setOutcome] = useState<"release" | "uphold">("release");

  const a = detail.data;
  const canEdit = can("stylist_programme", "edit");
  const hold = a ? holdState(a) : null;

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={a ? a.assignment_number : "Assignment"}
      subtitle={a ? `${a.service_key} · ${ASSIGNMENT_STATUS_META[a.status].label}` : undefined}
    >
      {detail.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-text-primary/[0.05] animate-pulse" />
          ))}
        </div>
      )}
      {detail.isError && (
        <ErrorState
          message={(detail.error as Error).message}
          onRetry={() => detail.refetch()}
        />
      )}
      {a && (
        <div className="space-y-5">
          <div className="glass rounded-xl p-4 grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <div className="micro">Offered</div>
              <div className="tabular-nums">{new Date(a.offered_at).toLocaleString()}</div>
            </div>
            <div>
              <div className="micro">Offer expires</div>
              <div className="tabular-nums">{new Date(a.offer_expires_at).toLocaleString()}</div>
            </div>
            <div>
              <div className="micro">Payout snapshot</div>
              <div>
                {a.net_payout ? (
                  <>
                    <MoneyText ngn={Number(a.net_payout)} /> net
                    <span className="text-text-faint text-[11px]">
                      {" "}(rate ×{Number(a.tier_multiplier)} − {Number(a.platform_fee_pct)}% fee)
                    </span>
                  </>
                ) : (
                  "Set at acceptance"
                )}
              </div>
            </div>
            <div>
              <div className="micro">Quality hold (Q14)</div>
              {hold && <Pill tone={hold.tone} dot={false}>{hold.label}</Pill>}
            </div>
            {a.customer_rating && (
              <div className="col-span-2">
                <div className="micro">Verified review</div>
                <div>
                  {a.customer_rating}★{a.customer_review ? ` — “${a.customer_review}”` : ""}
                </div>
              </div>
            )}
            {a.disputed_at && (
              <div className="col-span-2">
                <div className="micro">Dispute</div>
                <div className="text-[12.5px]">
                  {a.dispute_reason}
                  {a.dispute_resolved_at && (
                    <span className="text-success"> · resolved</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Offers */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="micro">Offers ({a.offers.length})</h3>
              {canEdit && a.status === "offered_pool" && (
                <Button size="sm" icon={<Compass className="w-3.5 h-3.5" />} onClick={() => setSuggesting(true)}>
                  Suggest & offer
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {a.offers.map((o) => (
                <div key={o.offer_id} className="glass rounded-xl p-3 flex items-center justify-between text-[12.5px]">
                  <span className="font-mono">{o.stylist_id.slice(0, 8)}…</span>
                  <span className="flex items-center gap-2">
                    {o.match_score != null && (
                      <span className="tabular-nums text-text-faint">
                        #{o.match_rank} · {Number(o.match_score)}
                      </span>
                    )}
                    <Pill
                      dot={false}
                      tone={
                        o.response === "accepted"
                          ? "success"
                          : o.response === "pending"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {o.response}
                    </Pill>
                  </span>
                </div>
              ))}
              {a.offers.length === 0 && (
                <p className="text-[12.5px] text-text-faint">
                  Nobody has been offered this job yet.
                </p>
              )}
            </div>
          </section>

          {canEdit && (
            <section className="flex gap-2 flex-wrap border-t hairline pt-4">
              {["completed", "in_progress"].includes(a.status) &&
                !(a.disputed_at && !a.dispute_resolved_at) && (
                  <Button size="sm" variant="danger" onClick={() => setDisputing("open")}>
                    Open dispute
                  </Button>
                )}
              {a.disputed_at && !a.dispute_resolved_at && (
                <Button size="sm" variant="primary" onClick={() => setDisputing("resolve")}>
                  Resolve dispute
                </Button>
              )}
              {["offered_pool", "escalated_to_admin"].includes(a.status) && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={m.cancel.isPending}
                  onClick={() => m.cancel.mutate(undefined)}
                >
                  Cancel assignment
                </Button>
              )}
            </section>
          )}
        </div>
      )}

      {suggesting && a && (
        <SuggestDrawer
          assignmentId={assignmentId}
          serviceKey={a.service_key}
          onClose={() => setSuggesting(false)}
        />
      )}

      <ConfirmDialog
        open={disputing === "open"}
        title="Open a dispute?"
        busy={m.dispute.isPending}
        confirmLabel="Open dispute"
        message={
          <div className="space-y-3 text-left">
            <p>The payable freezes and the partner is notified while Operations reviews.</p>
            <textarea
              className="input w-full min-h-[70px]"
              placeholder="What did the customer report?"
              value={disputeText}
              onChange={(e) => setDisputeText(e.target.value)}
            />
          </div>
        }
        onConfirm={() =>
          m.dispute.mutate(
            { action: "open", reason: disputeText || undefined },
            { onSuccess: () => setDisputing(null) },
          )
        }
        onClose={() => setDisputing(null)}
      />
      <ConfirmDialog
        open={disputing === "resolve"}
        title="Resolve the dispute"
        tone="accent"
        busy={m.dispute.isPending}
        confirmLabel="Resolve"
        message={
          <div className="space-y-3 text-left">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={outcome === "release" ? "primary" : "secondary"}
                onClick={() => setOutcome("release")}
              >
                Release payment
              </Button>
              <Button
                size="sm"
                variant={outcome === "uphold" ? "primary" : "secondary"}
                onClick={() => setOutcome("uphold")}
              >
                Uphold — void payable
              </Button>
            </div>
            <textarea
              className="input w-full min-h-[70px]"
              placeholder="Resolution note"
              value={disputeText}
              onChange={(e) => setDisputeText(e.target.value)}
            />
          </div>
        }
        onConfirm={() =>
          m.dispute.mutate(
            { action: "resolve", resolution: disputeText || undefined, outcome },
            { onSuccess: () => setDisputing(null) },
          )
        }
        onClose={() => setDisputing(null)}
      />
    </Drawer>
  );
}

export function AssignmentsPanel() {
  const [status, setStatus] = useState("");
  const assignments = useAssignments({ status: status || undefined });
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<Assignment>[] = [
    {
      key: "number",
      header: "Assignment",
      render: (a) => (
        <div>
          <div className="font-mono text-[12px]">{a.assignment_number}</div>
          <div className="text-[11px] text-text-faint">{a.service_key}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <Pill tone={ASSIGNMENT_STATUS_META[a.status].tone}>
          {ASSIGNMENT_STATUS_META[a.status].label}
        </Pill>
      ),
    },
    {
      key: "payout",
      header: "Net payout",
      align: "right",
      render: (a) =>
        a.net_payout ? (
          <MoneyText ngn={Number(a.net_payout)} />
        ) : (
          <span className="text-text-faint text-[12px]">—</span>
        ),
    },
    {
      key: "hold",
      header: "Quality hold",
      render: (a) => {
        const h = holdState(a);
        return h.label === "—" ? (
          <span className="text-text-faint text-[12px]">—</span>
        ) : (
          <Pill tone={h.tone} dot={false}>{h.label}</Pill>
        );
      },
    },
    {
      key: "created",
      header: "Opened",
      render: (a) => (
        <span className="tabular-nums text-[12px]">
          {new Date(a.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

  if (assignments.isError)
    return (
      <ErrorState
        message={(assignments.error as Error).message}
        onRetry={() => assignments.refetch()}
      />
    );

  return (
    <>
      <DataTable
        columns={columns}
        rows={assignments.data ?? []}
        rowKey={(a) => a.assignment_id}
        loading={assignments.isLoading}
        onRowClick={(a) => setOpenId(a.assignment_id)}
        toolbar={
          <select
            className="input h-9 text-[12.5px]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(ASSIGNMENT_STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        }
        empty={{
          icon: <Route className="w-6 h-6" />,
          title: "No assignments",
          message:
            "Routed styling jobs appear here — opened from service bookings or by Smartcomm.",
        }}
      />
      {openId && (
        <AssignmentDrawer assignmentId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

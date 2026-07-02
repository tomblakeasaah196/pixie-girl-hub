/**
 * Payout workbench (§6.26 Q16). Customer pays Pixie; Pixie pays the partner.
 * Generate collects quality-hold-cleared assignments + payable referral
 * commissions; submit routes through the workflow engine (CEO/Finance);
 * payment execution is manual — record the transfer reference (cross-border
 * licensing flag in the spec; automation comes later).
 */

import { useState } from "react";
import { Wallet } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, ConfirmDialog } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import { usePayouts, usePayout, usePayoutMutations, usePartners } from "./hooks";
import { PAYOUT_STATUS_META } from "./constants";
import type { Payout } from "./types";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Period columns come back as timestamps; render the calendar day. */
function fmtDay(v: string): string {
  return new Date(v).toLocaleDateString();
}

function GenerateDrawer({ onClose }: { onClose: () => void }) {
  const partners = usePartners({ status: "certified" });
  const { generate } = usePayoutMutations();
  const [stylistId, setStylistId] = useState("");
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());

  return (
    <Drawer
      open
      onClose={onClose}
      title="Generate payout batch"
      subtitle="Collects hold-cleared assignments + payable referral commissions for the period"
    >
      <div className="space-y-4">
        <div>
          <label className="label">Partner</label>
          <select
            className="input w-full"
            value={stylistId}
            onChange={(e) => setStylistId(e.target.value)}
          >
            <option value="">Select partner…</option>
            {(partners.data ?? []).map((p) => (
              <option key={p.stylist_id} value={p.stylist_id}>
                {p.display_name} ({p.partner_code})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Period start</label>
            <input
              type="date"
              className="input w-full tabular-nums"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Period end</label>
            <input
              type="date"
              className="input w-full tabular-nums"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <Button
          variant="primary"
          disabled={!stylistId || generate.isPending}
          onClick={() =>
            generate.mutate(
              { stylist_id: stylistId, period_start: start, period_end: end },
              { onSuccess: onClose },
            )
          }
        >
          {generate.isPending ? "Generating…" : "Generate draft"}
        </Button>
        {generate.isError && (
          <p className="text-danger text-[12px]">
            {(generate.error as Error).message}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function PayoutDrawer({
  payoutId,
  onClose,
}: {
  payoutId: string;
  onClose: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const detail = usePayout(payoutId);
  const m = usePayoutMutations();
  const [paying, setPaying] = useState(false);
  const [transferCode, setTransferCode] = useState("");

  const p = detail.data;
  const canEdit = can("stylist_programme", "edit");
  const canApprove = can("stylist_programme", "approve");

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={p ? p.payout_number : "Payout"}
      subtitle={p ? `${fmtDay(p.period_start)} → ${fmtDay(p.period_end)}` : undefined}
    >
      {detail.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
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
      {p && (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Pill tone={PAYOUT_STATUS_META[p.status].tone}>
              {PAYOUT_STATUS_META[p.status].label}
            </Pill>
            {p.workflow_instance_id && (
              <span className="micro">workflow-gated</span>
            )}
          </div>

          <div className="glass rounded-xl p-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="micro">Gross</div>
              <MoneyText ngn={Number(p.gross_amount)} />
            </div>
            <div>
              <div className="micro">Platform fee</div>
              <MoneyText ngn={Number(p.platform_fee_amount)} />
            </div>
            <div>
              <div className="micro">Net to partner</div>
              <MoneyText ngn={Number(p.net_amount)} className="text-accent-glow" />
            </div>
          </div>

          <section>
            <h3 className="micro mb-2">Lines ({p.lines?.length ?? 0})</h3>
            <div className="space-y-2">
              {(p.lines ?? []).map((l) => (
                <div key={l.line_id} className="glass rounded-xl p-3 flex items-center justify-between text-[12.5px]">
                  <span>
                    <Pill dot={false} tone={l.line_kind === "referral" ? "info" : "accent"}>
                      {l.line_kind}
                    </Pill>{" "}
                    {l.description}
                  </span>
                  <MoneyText ngn={Number(l.net_amount)} />
                </div>
              ))}
            </div>
          </section>

          <section className="flex gap-2 flex-wrap border-t hairline pt-4">
            {canEdit && p.status === "draft" && (
              <Button
                variant="primary"
                size="sm"
                disabled={m.submit.isPending}
                onClick={() => m.submit.mutate(p.payout_id)}
              >
                Submit for approval
              </Button>
            )}
            {canApprove && ["draft", "pending_approval"].includes(p.status) && (
              <Button
                variant="primary"
                size="sm"
                disabled={m.approve.isPending}
                onClick={() => m.approve.mutate(p.payout_id)}
              >
                Approve
              </Button>
            )}
            {canApprove && p.status === "approved" && (
              <Button variant="primary" size="sm" onClick={() => setPaying(true)}>
                Mark paid…
              </Button>
            )}
            {(m.submit.isError || m.approve.isError) && (
              <p className="text-danger text-[12px] w-full">
                {((m.submit.error || m.approve.error) as Error).message}
              </p>
            )}
          </section>
          {p.status === "paid" && (
            <p className="text-[12px] text-text-muted">
              Paid {p.paid_at && new Date(p.paid_at).toLocaleString()}
              {p.paystack_transfer_code && (
                <> · ref <span className="font-mono">{p.paystack_transfer_code}</span></>
              )}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={paying}
        title="Mark payout as paid"
        tone="accent"
        busy={m.markPaid.isPending}
        confirmLabel="Mark paid"
        message={
          <div className="space-y-3 text-left">
            <p>
              Record the bank/Paystack transfer reference. The partner is
              notified and their referral commissions flip to paid.
            </p>
            <input
              className="input w-full font-mono"
              placeholder="Transfer reference (e.g. TRF-…)"
              value={transferCode}
              onChange={(e) => setTransferCode(e.target.value)}
            />
          </div>
        }
        onConfirm={() =>
          m.markPaid.mutate([payoutId, transferCode || undefined], {
            onSuccess: () => setPaying(false),
          })
        }
        onClose={() => setPaying(false)}
      />
    </Drawer>
  );
}

export function PayoutsPanel() {
  const can = useAuthStore((s) => s.can);
  const [status, setStatus] = useState("");
  const payouts = usePayouts({ status: status || undefined });
  const partners = usePartners({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const partnerName = (id: string) =>
    partners.data?.find((p) => p.stylist_id === id)?.display_name ?? id.slice(0, 8);

  const columns: Column<Payout>[] = [
    {
      key: "number",
      header: "Payout",
      render: (p) => <span className="font-mono text-[12px]">{p.payout_number}</span>,
    },
    { key: "partner", header: "Partner", render: (p) => partnerName(p.stylist_id) },
    {
      key: "period",
      header: "Period",
      render: (p) => (
        <span className="tabular-nums text-[12px]">
          {fmtDay(p.period_start)} → {fmtDay(p.period_end)}
        </span>
      ),
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      render: (p) => <MoneyText ngn={Number(p.net_amount)} />,
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <Pill tone={PAYOUT_STATUS_META[p.status].tone}>
          {PAYOUT_STATUS_META[p.status].label}
        </Pill>
      ),
    },
  ];

  if (payouts.isError)
    return (
      <ErrorState
        message={(payouts.error as Error).message}
        onRetry={() => payouts.refetch()}
      />
    );

  return (
    <>
      <DataTable
        columns={columns}
        rows={payouts.data ?? []}
        rowKey={(p) => p.payout_id}
        loading={payouts.isLoading}
        onRowClick={(p) => setOpenId(p.payout_id)}
        toolbar={
          <>
            <select
              className="input h-9 text-[12.5px]"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(PAYOUT_STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            {can("stylist_programme", "create") && (
              <Button size="sm" className="ml-auto" onClick={() => setGenerating(true)}>
                Generate batch
              </Button>
            )}
          </>
        }
        empty={{
          icon: <Wallet className="w-6 h-6" />,
          title: "No payouts yet",
          message:
            "Generate a batch to collect a partner's payable work and referral commissions.",
          action: can("stylist_programme", "create") ? (
            <Button size="sm" onClick={() => setGenerating(true)}>
              Generate batch
            </Button>
          ) : undefined,
        }}
      />
      {generating && <GenerateDrawer onClose={() => setGenerating(false)} />}
      {openId && <PayoutDrawer payoutId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

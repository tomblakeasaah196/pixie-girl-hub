import { useState } from "react";
import { ClipboardList, Check, X, Undo2 } from "lucide-react";
import { Button, Pill, MoneyText } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useProposals, useProposal, useProposalMutations } from "./hooks";
import {
  PROPOSAL_STATUS_META,
  PROPOSAL_STATUS_TABS,
  fmtDate,
  marginTone,
  fmtPct,
} from "./constants";
import type { Proposal } from "./types";

export function ProposalsTab({ canApprove }: { canApprove: boolean }) {
  const [status, setStatus] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useProposals(
    status || undefined,
  );

  const cols: Column<Proposal>[] = [
    {
      key: "number",
      header: "#",
      width: "120px",
      render: (p) => (
        <span className="font-mono text-[11px] text-accent-glow">
          {p.proposal_number}
        </span>
      ),
    },
    {
      key: "title",
      header: "Proposal",
      render: (p) => (
        <div>
          <div className="font-semibold text-[13px] truncate max-w-[280px]">
            {p.title}
          </div>
          {p.description && (
            <div className="text-[11px] text-text-faint truncate max-w-[280px]">
              {p.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "variants",
      header: "Variants",
      align: "right",
      width: "90px",
      render: (p) => (
        <span className="font-mono text-xs">{p.variants_count}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "150px",
      render: (p) => {
        const m = PROPOSAL_STATUS_META[p.status];
        return <Pill tone={m.tone}>{m.label}</Pill>;
      },
    },
    {
      key: "date",
      header: "Created",
      width: "110px",
      render: (p) => (
        <span className="text-text-faint text-xs">{fmtDate(p.created_at)}</span>
      ),
    },
  ];

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        {PROPOSAL_STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={cn(
              "px-3.5 h-8 rounded-[9px] text-[12.5px] font-semibold transition-colors",
              status === t.value
                ? "bg-accent-deep text-[#F4E9D9]"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={cols}
        rows={data ?? []}
        rowKey={(p) => p.proposal_id}
        onRowClick={(p) => setOpenId(p.proposal_id)}
        loading={isLoading}
        empty={{
          icon: <ClipboardList className="w-7 h-7" />,
          title: "No proposals",
          message:
            "Price changes over the instant-apply threshold appear here for CEO approval.",
        }}
      />

      <ProposalDrawer
        id={openId}
        canApprove={canApprove}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function ProposalDrawer({
  id,
  canApprove,
  onClose,
}: {
  id: string | null;
  canApprove: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useProposal(id);
  const { approve, reject, revert } = useProposalMutations();
  const [action, setAction] = useState<"reject" | "revert" | null>(null);
  const [reason, setReason] = useState("");

  const close = () => {
    setAction(null);
    setReason("");
    onClose();
  };

  const p = data;
  const isPending = p?.status === "pending_approval";
  const isApplied = p?.status === "applied";

  return (
    <Drawer
      open={!!id}
      onClose={close}
      title={p ? p.title : "Proposal"}
      subtitle={p?.proposal_number}
      wide
      footer={
        canApprove && p ? (
          <div className="flex gap-2 w-full justify-end">
            {isPending && (
              <>
                <Button
                  variant="ghost"
                  icon={<X className="w-4 h-4" />}
                  onClick={() => setAction("reject")}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  icon={<Check className="w-4 h-4" />}
                  disabled={approve.isPending}
                  onClick={() =>
                    approve.mutate(p.proposal_id, { onSuccess: close })
                  }
                >
                  {approve.isPending ? "Approving…" : "Approve & apply"}
                </Button>
              </>
            )}
            {isApplied && (
              <Button
                icon={<Undo2 className="w-4 h-4" />}
                onClick={() => setAction("revert")}
              >
                Revert
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {isLoading || !p ? (
        <div className="h-40 animate-pulse rounded-[12px] bg-text-primary/[0.04]" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Pill tone={PROPOSAL_STATUS_META[p.status].tone}>
              {PROPOSAL_STATUS_META[p.status].label}
            </Pill>
            <span className="text-[12px] text-text-faint">
              {p.variants_count} variant{p.variants_count === 1 ? "" : "s"}
            </span>
          </div>
          {p.description && (
            <p className="text-[13px] text-text-muted">{p.description}</p>
          )}
          {p.rejection_reason && (
            <div className="rounded-[11px] border border-danger/30 bg-danger/[0.06] p-3 text-[12.5px] text-danger">
              Rejected: {p.rejection_reason}
            </div>
          )}

          {action ? (
            <div className="rounded-[12px] border border-line p-3 space-y-2">
              <div className="text-[12.5px] font-semibold capitalize">
                {action} reason
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why?"
                className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAction(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={reject.isPending || revert.isPending}
                  onClick={() => {
                    const mut = action === "reject" ? reject : revert;
                    mut.mutate(
                      { id: p.proposal_id, reason: reason.trim() || undefined },
                      { onSuccess: close },
                    );
                  }}
                >
                  Confirm {action}
                </Button>
              </div>
            </div>
          ) : null}

          {/* Result lines */}
          <div className="rounded-[12px] border border-line overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-text-faint text-left border-b hairline">
                  <th className="py-2 px-3 font-semibold">Variant</th>
                  <th className="py-2 px-3 font-semibold text-right">
                    Current
                  </th>
                  <th className="py-2 px-3 font-semibold text-right">
                    Proposed
                  </th>
                  <th className="py-2 px-3 font-semibold text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {(p.results ?? []).map((r) => (
                  <tr
                    key={r.result_id}
                    className="border-b hairline last:border-0"
                  >
                    <td className="py-2 px-3 font-mono text-[10.5px] text-text-faint">
                      {r.variant_id.slice(0, 8)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {r.current_price_ngn ? (
                        <MoneyText
                          ngn={Number(r.current_price_ngn)}
                          className="text-[12px] text-text-muted"
                        />
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MoneyText
                        ngn={Number(r.proposed_price_ngn)}
                        className="text-[12px]"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        <Pill tone={marginTone(r.proposed_margin_pct)}>
                          {fmtPct(r.proposed_margin_pct)}
                        </Pill>
                        {r.floor_breached && (
                          <span className="text-danger text-[10px]">floor</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}

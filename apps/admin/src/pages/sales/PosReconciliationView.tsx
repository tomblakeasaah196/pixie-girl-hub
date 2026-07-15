import { useEffect, useState } from "react";
import {
  Landmark,
  Search,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { MoneyText, Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { ErrorState } from "@/components/ui/controls";
import { formatDate, formatTime } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore, useBusinesses } from "@/stores/business";
import { useToastStore } from "@/components/notifications/NotificationToast";
import {
  usePosReconciliation,
  usePosReconciliationUnresolved,
  usePosReconciliationSuggestions,
  usePosReconcilableOrderSearch,
  useMatchPosReconciliation,
  useIgnorePosReconciliation,
} from "./hooks";
import type {
  PosTerminalReconciliation,
  PosReconOrderCandidate,
  PaginatedResponse,
} from "./types";

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Decision 7B: color-coded age so a stale item is obvious without doing
 *  the math — green under 1h, amber under 24h, red beyond that. */
function ageInfo(row: PosTerminalReconciliation) {
  const ts = row.transaction_time || row.created_at;
  const ms = Date.now() - new Date(ts).getTime();
  const hours = ms / 3_600_000;
  const label =
    hours < 1
      ? `${Math.max(1, Math.round(ms / 60_000))}m`
      : hours < 48
        ? `${Math.round(hours)}h`
        : `${Math.round(hours / 24)}d`;
  const className =
    hours < 1
      ? "bg-success/10 text-success"
      : hours < 24
        ? "bg-warn/10 text-warn"
        : "bg-danger/10 text-danger";
  return { label, className };
}

function toast(
  title: string,
  body: string,
  priority: "normal" | "high" = "normal",
) {
  useToastStore.getState().add({
    notification_id: crypto.randomUUID(),
    user_id: "",
    business: null,
    type: "order",
    priority,
    title,
    body,
    reference_type: null,
    reference_id: null,
    action_url: null,
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
  });
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Prev/Next pager shared by both lists in this tab — 15 per page keeps a
 *  busy queue from turning into one long overwhelming scroll. Wraps onto
 *  two lines on narrow screens instead of squeezing the count + buttons
 *  into one cramped row. */
function Pager({
  meta,
  onPrev,
  onNext,
}: {
  meta: PaginatedResponse<unknown>["meta"];
  onPrev: () => void;
  onNext: () => void;
}) {
  if (meta.total <= meta.page_size) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-muted mt-3 px-1">
      <span>
        Showing {(meta.page - 1) * meta.page_size + 1}–
        {Math.min(meta.page * meta.page_size, meta.total)} of {meta.total}
      </span>
      <div className="flex gap-1">
        <button
          disabled={meta.page <= 1}
          onClick={onPrev}
          className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
        >
          Prev
        </button>
        <button
          disabled={!meta.has_more}
          onClick={onNext}
          className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** One candidate order row — used for both smart suggestions and manual
 *  search results (decision 1A: same landing action either way). */
function CandidateRow({
  candidate,
  onMatch,
  busy,
}: {
  candidate: PosReconOrderCandidate;
  onMatch: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-[10px] border border-line hover:border-accent/40 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13px] font-semibold truncate">
          {candidate.order_number}
        </div>
        <div className="text-[11px] text-text-muted truncate">
          Balance <MoneyText ngn={Number(candidate.balance_due_ngn)} /> ·{" "}
          {formatDate(candidate.created_at)}
        </div>
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={onMatch}
        className="shrink-0"
      >
        <CheckCircle className="w-3.5 h-3.5" />
        Match
      </Button>
    </div>
  );
}

function MatchModal({
  row,
  onClose,
}: {
  row: PosTerminalReconciliation | null;
  onClose: () => void;
}) {
  const businesses = useBusinesses();
  const activeKey = useBusinessStore((s) => s.activeKey);
  const [brand, setBrand] = useState(activeKey);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const match = useMatchPosReconciliation();

  useEffect(() => {
    if (row) setBrand(row.resolved_brand || activeKey);
    setSearch("");
  }, [row, activeKey]);

  const targetBrand = row?.resolved_brand || brand;
  const suggestions = usePosReconciliationSuggestions(
    row?.recon_id ?? null,
    targetBrand,
  );
  const manualResults = usePosReconcilableOrderSearch(debouncedSearch);

  if (!row) return null;

  async function handleMatch(order_id: string) {
    try {
      await match.mutateAsync({
        id: row!.recon_id,
        input: { brand: targetBrand, order_id },
      });
      toast(
        "Payment matched",
        `₦${Number(row!.amount_ngn).toLocaleString()} applied to the order.`,
      );
      onClose();
    } catch (err) {
      toast("Match failed", errMessage(err, "Could not match this payment."), "high");
    }
  }

  return (
    <Modal open onClose={onClose} title="Match POS payment" size="lg">
      <div className="space-y-5">
        <div className="rounded-[10px] border border-line p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">
              <MoneyText ngn={Number(row.amount_ngn)} />
            </div>
            <div className="text-[11px] text-text-muted truncate">
              {row.alias_account_name || "Unknown sender"} ·{" "}
              {row.transaction_time
                ? `${formatDate(row.transaction_time)} ${formatTime(row.transaction_time)}`
                : "time unknown"}
            </div>
          </div>
          {!row.resolved_brand && (
            <div className="flex flex-wrap gap-1.5">
              {businesses.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBrand(b.key)}
                  className={`px-3 h-8 rounded-[8px] text-[12px] font-semibold border transition-colors ${
                    brand === b.key
                      ? "border-accent bg-accent/[0.12] text-accent"
                      : "border-line text-text-muted hover:border-accent/40"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[12px] font-semibold text-text-muted mb-2">
            Suggested orders
          </div>
          {suggestions.isLoading ? (
            <div className="text-[12px] text-text-muted">Searching…</div>
          ) : suggestions.data && suggestions.data.data.length > 0 ? (
            <div className="space-y-2">
              {suggestions.data.data.map((c) => (
                <CandidateRow
                  key={c.order_id}
                  candidate={c}
                  busy={match.isPending}
                  onMatch={() => handleMatch(c.order_id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-text-muted">
              No open order with a matching balance nearby — search manually below.
            </div>
          )}
        </div>

        <div>
          <div className="text-[12px] font-semibold text-text-muted mb-2">
            Manual search
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order number or customer name…"
              autoComplete="off"
              className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
            />
          </div>
          {debouncedSearch.trim().length > 1 && (
            <div className="space-y-2">
              {manualResults.data && manualResults.data.data.length > 0 ? (
                manualResults.data.data.map((o) => (
                  <CandidateRow
                    key={o.order_id}
                    candidate={{
                      order_id: o.order_id,
                      order_number: o.order_number,
                      status: o.status,
                      total_ngn: o.total_ngn,
                      amount_paid_ngn: o.amount_paid_ngn,
                      balance_due_ngn: o.balance_due_ngn,
                      created_at: o.created_at,
                    }}
                    busy={match.isPending}
                    onMatch={() => handleMatch(o.order_id)}
                  />
                ))
              ) : (
                <div className="text-[12px] text-text-muted">No orders found.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function IgnoreModal({
  row,
  onClose,
}: {
  row: PosTerminalReconciliation | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const ignore = useIgnorePosReconciliation();

  useEffect(() => setNote(""), [row]);

  if (!row) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return;
    try {
      await ignore.mutateAsync({ id: row!.recon_id, note: note.trim() });
      toast("Payment ignored", "Removed from the pending queue.");
      onClose();
    } catch (err) {
      toast("Failed", errMessage(err, "Could not ignore this payment."), "high");
    }
  }

  return (
    <Modal open onClose={onClose} title="Ignore POS payment" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-[13px] text-text-muted leading-relaxed">
          This marks <MoneyText ngn={Number(row.amount_ngn)} /> as a false
          positive or duplicate — it won't be applied to any order. A short
          reason is required so this stays auditable.
        </p>
        <div>
          <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
            Reason
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. duplicate of PXG-SO-0142, already reconciled"
            className="w-full p-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 rounded-[9px] border border-line text-[13px] font-semibold hover:bg-text-primary/[0.05]"
          >
            Cancel
          </button>
          <Button
            type="submit"
            variant="danger"
            disabled={ignore.isPending || note.trim().length < 3}
          >
            <XCircle className="w-4 h-4" />
            Ignore
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function reconColumns(
  canEdit: boolean,
  onMatch: (row: PosTerminalReconciliation) => void,
  onIgnore: (row: PosTerminalReconciliation) => void,
): Column<PosTerminalReconciliation>[] {
  const cols: Column<PosTerminalReconciliation>[] = [
    {
      key: "amount",
      header: "Amount",
      render: (r) => <MoneyText ngn={Number(r.amount_ngn)} />,
    },
    {
      key: "sender",
      header: "Sender / terminal",
      render: (r) => (
        <div>
          <div className="text-[13px]">{r.alias_account_name || "—"}</div>
          <div className="text-[11px] text-text-muted font-mono">
            {r.nomba_terminal_id || "unknown terminal"}
          </div>
        </div>
      ),
    },
    {
      key: "received",
      header: "Received",
      width: "130px",
      render: (r) => (
        <span className="text-[12px] text-text-muted">
          {r.transaction_time ? (
            <>
              <span className="block">{formatDate(r.transaction_time)}</span>
              <span className="block text-[11px] opacity-70">
                {formatTime(r.transaction_time)}
              </span>
            </>
          ) : (
            "—"
          )}
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      width: "70px",
      render: (r) => {
        const a = ageInfo(r);
        return (
          <span
            className={`inline-flex items-center px-2 h-6 rounded-full text-[11px] font-bold ${a.className}`}
          >
            {a.label}
          </span>
        );
      },
    },
    {
      key: "reference",
      header: "Reference",
      render: (r) => (
        <span className="text-[12px] font-mono text-text-muted">
          {r.provider_reference || "—"}
        </span>
      ),
    },
  ];
  if (canEdit) {
    cols.push({
      key: "action",
      header: "",
      width: "170px",
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIgnore(r);
            }}
            className="px-3 h-7 rounded-[7px] border border-line text-text-muted text-[12px] font-semibold hover:bg-text-primary/[0.05] whitespace-nowrap"
          >
            Ignore
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMatch(r);
            }}
            className="px-3 h-7 rounded-[7px] border border-accent/40 text-accent text-[12px] font-semibold hover:bg-accent/[0.08] transition-colors whitespace-nowrap"
          >
            Match
          </button>
        </div>
      ),
    });
  }
  return cols;
}

export function PosReconciliationView() {
  const can = useAuthStore((s) => s.can);
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const canEdit = can("sales", "edit");

  const [matchRow, setMatchRow] = useState<PosTerminalReconciliation | null>(
    null,
  );
  const [ignoreRow, setIgnoreRow] = useState<PosTerminalReconciliation | null>(
    null,
  );
  // 15 per page on both lists — a queue that's grown to dozens of rows reads
  // as one long overwhelming scroll otherwise.
  const PAGE_SIZE = 15;
  const [page, setPage] = useState(1);
  const [unresolvedPage, setUnresolvedPage] = useState(1);

  const pending = usePosReconciliation({ page, page_size: PAGE_SIZE });
  const unresolved = usePosReconciliationUnresolved(isCeo, {
    page: unresolvedPage,
    page_size: PAGE_SIZE,
  });

  const rows = pending.data?.data ?? [];
  const meta = pending.data?.meta;
  const unresolvedRows = unresolved.data?.data ?? [];
  const unresolvedMeta = unresolved.data?.meta;
  const unresolvedTotal = unresolvedMeta?.total ?? 0;

  const columns = reconColumns(
    canEdit,
    (r) => setMatchRow(r),
    (r) => setIgnoreRow(r),
  );

  return (
    <>
      <div className="rounded-[13px] border border-warn/30 bg-warn/[0.06] px-4 py-3 mb-4 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
        <p className="text-[13px] text-warn font-semibold leading-snug">
          In-store terminal payments that arrived with no matching order sit
          here. Match them to the right order — the order is confirmed
          exactly as if the terminal had reported it directly — or ignore a
          false positive/duplicate with a reason.
        </p>
      </div>

      {isCeo && unresolvedTotal > 0 && (
        <div className="rounded-[13px] border border-accent/30 bg-accent/[0.05] px-4 py-3 mb-4">
          <p className="text-[13px] font-semibold mb-2">
            {unresolvedTotal} payment{unresolvedTotal === 1 ? "" : "s"} with no
            terminal on record yet — visible to you as CEO across both
            brands.
          </p>
          <div className="space-y-2">
            {unresolvedRows.map((r) => (
              <div
                key={r.recon_id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-[9px] bg-text-primary/[0.03]"
              >
                <div className="min-w-0 flex-1 truncate text-[13px]">
                  <MoneyText ngn={Number(r.amount_ngn)} /> —{" "}
                  <span className="text-text-muted">
                    {r.alias_account_name || "Unknown sender"}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() => setMatchRow(r)}
                  className="shrink-0"
                >
                  Resolve
                </Button>
              </div>
            ))}
          </div>
          {unresolvedMeta && (
            <Pager
              meta={unresolvedMeta}
              onPrev={() => setUnresolvedPage((p) => p - 1)}
              onNext={() => setUnresolvedPage((p) => p + 1)}
            />
          )}
        </div>
      )}

      {pending.isError ? (
        <ErrorState onRetry={() => pending.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.recon_id}
            loading={pending.isLoading}
            empty={{
              icon: <Landmark className="w-8 h-8" />,
              title: "Nothing to reconcile",
              message: "Every terminal payment has a matching order.",
            }}
          />
          {meta && (
            <Pager
              meta={meta}
              onPrev={() => setPage((p) => p - 1)}
              onNext={() => setPage((p) => p + 1)}
            />
          )}
        </>
      )}

      <MatchModal row={matchRow} onClose={() => setMatchRow(null)} />
      <IgnoreModal row={ignoreRow} onClose={() => setIgnoreRow(null)} />
    </>
  );
}

import { useMemo, useState } from "react";
import { BookOpen, Plus, Trash2, Undo2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  MoneyText,
  Pill,
  Skeleton,
  type Tone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Select } from "@/components/ui/controls";
import {
  useAccounts,
  useCreateJournal,
  useJournal,
  useJournals,
  useReverseJournal,
} from "./hooks";
import type { JournalEntry, ManualJournalLineInput } from "./types";

const STATUS_TONE: Record<string, Tone> = {
  posted: "success",
  reversed: "warn",
  draft: "neutral",
};

const inputCls =
  "w-full h-[38px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

const num = (v: string | number | undefined | null) => Number(v || 0);

export default function JournalsTab() {
  const can = useAuthStore((s) => s.can);
  const [page, setPage] = useState(1);
  const [sourceType, setSourceType] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState<false | "manual" | "opening">(false);
  const { data, isLoading } = useJournals({
    source_type: sourceType || undefined,
    page,
  });

  const cols: Column<JournalEntry>[] = [
    { key: "no", header: "Entry", width: "130px", render: (r) => <span className="font-mono text-xs">{r.entry_number}</span> },
    { key: "date", header: "Date", width: "105px", render: (r) => String(r.posting_date).slice(0, 10) },
    { key: "src", header: "Source", width: "130px", render: (r) => <Pill tone="neutral">{r.source_type}</Pill> },
    { key: "desc", header: "Description", render: (r) => <span className="line-clamp-1">{r.description || r.reference || "—"}</span> },
    { key: "amt", header: "Amount", align: "right", render: (r) => <MoneyText ngn={num(r.total_debit_ngn)} /> },
    { key: "status", header: "Status", width: "100px", render: (r) => <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Pill> },
  ];

  const sources = [
    { value: "", label: "All sources" },
    ...[
      "sales", "invoice", "payment", "purchase", "goods_received", "payroll",
      "expense", "stock_adjustment", "refund", "tax_filing", "intercompany",
      "fx_revaluation", "accrual", "manual", "opening_balance", "reversal",
    ].map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-52">
          <Select value={sourceType} onChange={(v) => { setSourceType(v); setPage(1); }} options={sources} />
        </div>
        <div className="ml-auto flex gap-2">
          {can("accounting", "approve") && (
            <Button variant="secondary" onClick={() => setShowNew("opening")}>
              Opening Balances
            </Button>
          )}
          {can("accounting", "create") && (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowNew("manual")}>
              Manual Journal
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.entry_id}
        loading={isLoading}
        onRowClick={(r) => setSelected(r.entry_id)}
        empty={{
          icon: <BookOpen className="w-8 h-8" />,
          title: "No journal entries",
          message: "Business flows post here automatically; manual journals are for adjustments.",
        }}
      />
      {data && data.meta.total > data.meta.page_size && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="ghost" disabled={!data.meta.has_more} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {selected && <JournalDetailDrawer id={selected} onClose={() => setSelected(null)} />}
      {showNew && <ManualJournalDrawer opening={showNew === "opening"} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function JournalDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useAuthStore((s) => s.can);
  const { data: entry, isLoading } = useJournal(id);
  const reverse = useReverseJournal();

  return (
    <Drawer
      open
      onClose={onClose}
      title={entry?.entry_number ?? "Journal entry"}
      subtitle={entry ? `${entry.source_type} · ${String(entry.posting_date).slice(0, 10)}` : undefined}
      footer={
        entry?.status === "posted" && can("accounting", "approve") ? (
          <Button
            variant="secondary"
            icon={<Undo2 className="w-4 h-4" />}
            disabled={reverse.isPending}
            onClick={() => reverse.mutate({ id, reason: "Manual reversal" }, { onSuccess: onClose })}
          >
            {reverse.isPending ? "Reversing…" : "Reverse entry"}
          </Button>
        ) : undefined
      }
    >
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="w-full h-5" />)}
        </div>
      )}
      {entry && (
        <div className="space-y-4">
          {entry.description && <p className="text-sm text-text-muted">{entry.description}</p>}
          <Card className="divide-y divide-line/50">
            {(entry.lines ?? []).map((l) => (
              <div key={l.line_id} className="flex items-center justify-between p-3 text-sm gap-2">
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="font-mono text-xs text-text-faint mr-2">{l.account_code}</span>
                    {l.account_name}
                  </p>
                  {l.description && <p className="text-xs text-text-faint truncate">{l.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  {num(l.debit_ngn) > 0 ? (
                    <MoneyText ngn={num(l.debit_ngn)} />
                  ) : (
                    <MoneyText ngn={num(l.credit_ngn)} className="text-text-muted" />
                  )}
                  <p className="micro text-text-faint">{num(l.debit_ngn) > 0 ? "DR" : "CR"}</p>
                </div>
              </div>
            ))}
          </Card>
          {entry.status === "reversed" && (
            <Pill tone="warn">Reversed — see the linked reversal entry</Pill>
          )}
        </div>
      )}
    </Drawer>
  );
}

type LineDraft = { account_code: string; side: "DR" | "CR"; amount: string; description: string };
const BLANK: LineDraft = { account_code: "", side: "DR", amount: "", description: "" };

function ManualJournalDrawer({ opening, onClose }: { opening: boolean; onClose: () => void }) {
  const { data: accounts } = useAccounts();
  const create = useCreateJournal();
  const [description, setDescription] = useState(opening ? "Opening balances (go-live cutover)" : "");
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>([{ ...BLANK }, { ...BLANK, side: "CR" }]);
  const [error, setError] = useState<string | null>(null);

  const accountOptions = useMemo(
    () => [
      { value: "", label: "Select account…" },
      ...(accounts ?? [])
        .filter((a) => a.allow_posting && a.is_active)
        .map((a) => ({ value: a.account_code, label: `${a.account_code} · ${a.account_name}` })),
    ],
    [accounts],
  );

  const totals = lines.reduce(
    (t, l) => {
      const v = Number(l.amount || 0);
      if (l.side === "DR") t.dr += v;
      else t.cr += v;
      return t;
    },
    { dr: 0, cr: 0 },
  );
  const balanced = Math.abs(totals.dr - totals.cr) <= 0.01 && totals.dr > 0;

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    const payload: ManualJournalLineInput[] = lines
      .filter((l) => l.account_code && Number(l.amount) > 0)
      .map((l) => ({
        account_code: l.account_code,
        ...(l.side === "DR"
          ? { debit_ngn: Number(l.amount) }
          : { credit_ngn: Number(l.amount) }),
        ...(l.description ? { description: l.description } : {}),
      }));
    create.mutate(
      { input: { description, posting_date: postingDate, lines: payload }, opening },
      {
        onSuccess: onClose,
        onError: (e: unknown) =>
          setError(e instanceof Error ? e.message : "The journal was rejected."),
      },
    );
  };

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={opening ? "Opening Balances" : "Manual Journal"}
      subtitle={
        opening
          ? "One balanced journal carrying the agreed trial balance at cutover (posts once per date)."
          : "Balanced adjustment entry — debits must equal credits."
      }
      footer={
        <div className="flex items-center gap-3 w-full">
          <Pill tone={balanced ? "success" : "danger"}>
            DR {totals.dr.toLocaleString()} / CR {totals.cr.toLocaleString()}
          </Pill>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!balanced || !description || create.isPending} onClick={submit}>
              {create.isPending ? "Posting…" : "Post journal"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-text-muted mb-1.5">Description</label>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-text-muted mb-1.5">Posting date</label>
            <input type="date" className={inputCls} value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_88px_130px_32px] gap-2 items-center">
              <Select value={l.account_code} onChange={(v) => setLine(i, { account_code: v })} options={accountOptions} />
              <Select
                value={l.side}
                onChange={(v) => setLine(i, { side: v as "DR" | "CR" })}
                options={[{ value: "DR", label: "Debit" }, { value: "CR", label: "Credit" }]}
              />
              <input
                className={inputCls}
                inputMode="decimal"
                placeholder="0.00"
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value.replace(/[^\d.]/g, "") })}
              />
              <button
                className="text-text-faint hover:text-danger disabled:opacity-30"
                disabled={lines.length <= 2}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <Button variant="ghost" icon={<Plus className="w-4 h-4" />} onClick={() => setLines((ls) => [...ls, { ...BLANK }])}>
          Add line
        </Button>
        {error && <p className="text-danger text-sm">{error}</p>}
      </div>
    </Drawer>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, ChevronDown, MoreVertical } from "lucide-react";
import { MoneyText, Pill, Skeleton } from "@/components/ui/primitives";
import { StagePill } from "../shared/StagePill";
import { WonLostModal } from "./WonLostModal";
import type { Deal } from "@/pages/contacts/types";
import type { KanbanColumn } from "../types";

type SortKey =
  | "title"
  | "expected_value_ngn"
  | "expected_close_date"
  | "last_activity_at"
  | "status";

const STATUS_TONE = {
  open: "info",
  won: "success",
  lost: "danger",
  on_hold: "warn",
  cancelled: "neutral",
} as const;

interface TableViewProps {
  columns: KanbanColumn[];
  isLoading: boolean;
}

export function TableView({ columns, isLoading }: TableViewProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("expected_value_ngn");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [wonLostDeal, setWonLostDeal] = useState<Deal | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[52px] rounded-[11px]" />
        ))}
      </div>
    );
  }

  const allDeals = columns.flatMap((col) =>
    col.deals.map((d) => ({ ...d, _stageColour: col.stage.colour })),
  );

  const sorted = [...allDeals].sort((a, b) => {
    let va: string | number = "";
    let vb: string | number = "";
    switch (sortKey) {
      case "title":
        va = a.title.toLowerCase();
        vb = b.title.toLowerCase();
        break;
      case "expected_value_ngn":
        va = parseFloat(a.expected_value_ngn ?? "0");
        vb = parseFloat(b.expected_value_ngn ?? "0");
        break;
      case "expected_close_date":
        va = a.expected_close_date ?? "";
        vb = b.expected_close_date ?? "";
        break;
      case "last_activity_at":
        va = a.last_activity_at ?? "";
        vb = b.last_activity_at ?? "";
        break;
      case "status":
        va = a.status;
        vb = b.status;
        break;
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <ChevronDown className="w-3 h-3 text-text-faint/40" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 text-accent" />
    ) : (
      <ChevronDown className="w-3 h-3 text-accent" />
    );
  }

  function Th({
    label,
    col,
    right,
  }: {
    label: string;
    col?: SortKey;
    right?: boolean;
  }) {
    return (
      <th
        onClick={col ? () => toggleSort(col) : undefined}
        className={[
          "px-3 py-2 text-[10.5px] font-semibold text-text-faint whitespace-nowrap",
          right ? "text-right" : "text-left",
          col ? "cursor-pointer hover:text-text-primary select-none" : "",
        ].join(" ")}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {col && <SortIcon col={col} />}
        </span>
      </th>
    );
  }

  return (
    <>
      <div className="rounded-[14px] border hairline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-text-primary/[0.03] border-b hairline">
              <tr>
                <Th label="Deal" col="title" />
                <Th label="Contact" />
                <Th label="Stage" />
                <Th label="Status" col="status" />
                <Th label="Value" col="expected_value_ngn" right />
                <Th label="Close date" col="expected_close_date" />
                <Th label="Last activity" col="last_activity_at" />
                <Th label="" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((deal) => {
                const daysSince = deal.last_activity_at
                  ? Math.floor(
                      (Date.now() - new Date(deal.last_activity_at).getTime()) /
                        86_400_000,
                    )
                  : null;

                return (
                  <tr
                    key={deal.deal_id}
                    onClick={() => navigate(`/crm/deals/${deal.deal_id}`)}
                    className="border-b hairline last:border-0 hover:bg-text-primary/[0.04] transition-colors cursor-pointer group"
                  >
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <div className="text-[12.5px] font-medium text-text-primary truncate">
                        {deal.title}
                      </div>
                      <div className="text-[10.5px] text-text-faint">
                        {deal.deal_number}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-text-muted max-w-[140px]">
                      <span className="truncate block">
                        {deal.contact_name ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StagePill
                        stageName={deal.current_stage_name}
                        stageColour={
                          (deal as typeof deal & { _stageColour?: string })
                            ._stageColour
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill
                        tone={STATUS_TONE[deal.status] ?? "neutral"}
                        dot={false}
                      >
                        {deal.status}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {deal.expected_value_ngn ? (
                        <span className="text-[12px] font-mono text-text-primary">
                          <MoneyText
                            ngn={parseFloat(deal.expected_value_ngn)}
                          />
                        </span>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-text-muted whitespace-nowrap">
                      {deal.expected_close_date
                        ? new Date(deal.expected_close_date).toLocaleDateString(
                            "en-NG",
                            {
                              day: "numeric",
                              month: "short",
                            },
                          )
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-text-faint whitespace-nowrap">
                      {daysSince === null
                        ? "—"
                        : daysSince === 0
                          ? "Today"
                          : `${daysSince}d ago`}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWonLostDeal(deal);
                        }}
                        className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-faint">
            No deals
          </div>
        )}
      </div>

      {wonLostDeal && (
        <WonLostModal deal={wonLostDeal} onClose={() => setWonLostDeal(null)} />
      )}
    </>
  );
}

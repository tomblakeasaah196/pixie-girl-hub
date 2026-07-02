import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { Pill, type Tone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/controls";
import { useAccountGroups, useAccounts } from "./hooks";
import type { Account } from "./types";

const GROUP_TONE: Record<string, Tone> = {
  asset: "info",
  liability: "warn",
  equity: "neutral",
  revenue: "success",
  contra_revenue: "warn",
  expense: "danger",
};

export default function CoaTab() {
  const { data: groups } = useAccountGroups();
  const { data: accounts, isLoading } = useAccounts();
  const [groupFilter, setGroupFilter] = useState("");

  const groupById = useMemo(
    () => new Map((groups ?? []).map((g) => [g.group_id, g])),
    [groups],
  );
  const rows = (accounts ?? []).filter(
    (a) => !groupFilter || a.group_id === groupFilter,
  );

  const cols: Column<Account>[] = [
    { key: "code", header: "Code", width: "80px", render: (r) => <span className="font-mono text-xs">{r.account_code}</span> },
    { key: "name", header: "Account", render: (r) => r.account_name },
    {
      key: "group",
      header: "Class",
      width: "140px",
      render: (r) => {
        const g = groupById.get(r.group_id);
        return g ? <Pill tone={GROUP_TONE[g.group_type] ?? "neutral"}>{g.group_type}</Pill> : "—";
      },
    },
    { key: "ccy", header: "Currency", width: "90px", render: (r) => r.account_currency || "NGN" },
    {
      key: "flags",
      header: "Flags",
      render: (r) => (
        <span className="flex gap-1.5">
          {r.is_control_account && <Pill tone="info">control: {r.control_subledger}</Pill>}
          {!r.allow_posting && <Pill tone="warn">locked</Pill>}
          {!r.is_active && <Pill tone="danger">inactive</Pill>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="w-60">
        <Select
          value={groupFilter}
          onChange={setGroupFilter}
          options={[
            { value: "", label: "All classes" },
            ...(groups ?? []).map((g) => ({ value: g.group_id, label: g.group_name })),
          ]}
        />
      </div>
      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(r) => r.account_id}
        loading={isLoading}
        empty={{
          icon: <ListTree className="w-8 h-8" />,
          title: "No accounts",
          message: "The chart of accounts is seeded at business bootstrap.",
        }}
      />
    </div>
  );
}

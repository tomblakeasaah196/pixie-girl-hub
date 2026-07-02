import { CalendarRange } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Pill, type Tone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useClosePeriod, usePeriods } from "./hooks";
import type { FiscalPeriod } from "./types";

const STATUS_TONE: Record<string, Tone> = {
  open: "success",
  future: "neutral",
  closing: "warn",
  adjusted: "info",
  closed: "neutral",
  locked: "danger",
};

export default function PeriodsTab() {
  const can = useAuthStore((s) => s.can);
  const { data, isLoading } = usePeriods();
  const close = useClosePeriod();

  const cols: Column<FiscalPeriod>[] = [
    { key: "name", header: "Period", render: (r) => r.period_name },
    { key: "range", header: "Dates", render: (r) => `${String(r.starts_on).slice(0, 10)} → ${String(r.ends_on).slice(0, 10)}` },
    { key: "yr", header: "", width: "90px", render: (r) => (r.is_year_end ? <Pill tone="info">year end</Pill> : null) },
    { key: "status", header: "Status", width: "100px", render: (r) => <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Pill> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        can("accounting", "approve") && ["open", "adjusted"].includes(r.status) ? (
          <Button
            variant="ghost"
            disabled={close.isPending}
            onClick={() => {
              if (window.confirm(`Close ${r.period_name}? New journals will be rejected in this period.`))
                close.mutate(r.period_id);
            }}
          >
            Close period
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={cols}
      rows={data ?? []}
      rowKey={(r) => r.period_id}
      loading={isLoading}
      empty={{
        icon: <CalendarRange className="w-8 h-8" />,
        title: "No fiscal periods",
        message: "Periods are seeded for the current year at bootstrap.",
      }}
    />
  );
}

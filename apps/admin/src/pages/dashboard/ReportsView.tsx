/**
 * Reports — the §6.30 weekly auto-reports surface inside the dashboard:
 * a review→confirm queue (staff check the generated figures before the CEO
 * copy goes out), the full run history with PDF/Excel downloads, and the
 * schedule of system templates. No query builder — ad-hoc needs are served
 * by each domain's filtered Excel export.
 */

import { useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Inbox,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Pill } from "@/components/ui/primitives";
import {
  downloadReportRunExcel,
  useConfirmReportRun,
  useQueueReportPdf,
  useReportRuns,
  useReportTemplates,
  type ReportRun,
} from "@/lib/dashboards-api";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const STATUS_TONE: Record<ReportRun["status"], "success" | "warn" | "danger" | "neutral"> = {
  queued: "neutral",
  running: "neutral",
  completed: "success",
  failed: "danger",
  needs_confirmation: "warn",
  confirmed: "success",
  sent: "success",
  cancelled: "neutral",
};

function fmtPeriod(run: ReportRun): string {
  const day = (v: string | null) => (v ? v.slice(0, 10) : "…");
  return `${day(run.period_start)} → ${day(run.period_end)}`;
}

export function ReportsView({ canApprove, canExport }: { canApprove: boolean; canExport: boolean }) {
  const can = useAuthStore((s) => s.can);
  const [page, setPage] = useState(1);
  const queue = useReportRuns({ status: "needs_confirmation" });
  const history = useReportRuns({ page });
  const templates = useReportTemplates();
  const confirm = useConfirmReportRun();
  const queuePdf = useQueueReportPdf();
  const [busyId, setBusyId] = useState<string | null>(null);

  const download = async (run: ReportRun, kind: "excel" | "pdf") => {
    setBusyId(run.run_id);
    try {
      if (kind === "excel") {
        await downloadReportRunExcel(run.run_id, run.run_number);
      } else {
        await queuePdf.mutateAsync(run.run_id);
      }
    } finally {
      setBusyId(null);
    }
  };

  const actionCol: Column<ReportRun> = {
    key: "actions",
    header: "",
    align: "right",
    render: (run) => (
      <span className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {run.status === "needs_confirmation" && (canApprove || can("dashboards", "approve")) && (
          <Button
            variant="secondary"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate({ id: run.run_id })}
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          >
            Confirm
          </Button>
        )}
        {canExport && (
          <Button
            variant="ghost"
            disabled={busyId === run.run_id}
            onClick={() => download(run, "excel")}
            icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
          >
            Excel
          </Button>
        )}
        {canExport && (
          <Button
            variant="ghost"
            disabled={busyId === run.run_id}
            onClick={() => download(run, "pdf")}
            icon={<FileDown className="w-3.5 h-3.5" />}
            title="Queues a PDF render; it appears in Documents when ready"
          >
            PDF
          </Button>
        )}
      </span>
    ),
  };

  const runColumns: Column<ReportRun>[] = [
    {
      key: "run_number",
      header: "Run",
      render: (r) => <span className="font-mono text-[12px]">{r.run_number}</span>,
    },
    {
      key: "template",
      header: "Report",
      render: (r) => r.template_name ?? "—",
    },
    { key: "period", header: "Period", render: fmtPeriod },
    {
      key: "status",
      header: "Status",
      render: (r) => <Pill tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Pill>,
    },
    {
      key: "created",
      header: "Generated",
      render: (r) => new Date(r.created_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
    actionCol,
  ];

  const meta = history.data?.meta;

  return (
    <div className="space-y-5">
      {(queue.data?.data.length ?? 0) > 0 && (
        <DataTable
          columns={runColumns}
          rows={queue.data?.data ?? []}
          rowKey={(r) => r.run_id}
          loading={queue.isLoading}
          toolbar={
            <span className="micro flex items-center gap-2">
              <Inbox className="w-3.5 h-3.5" /> Awaiting review — confirm before the CEO copy goes out
            </span>
          }
          empty={{ icon: <Inbox className="w-6 h-6" />, title: "Queue is clear" }}
        />
      )}

      <DataTable
        columns={runColumns}
        rows={history.data?.data ?? []}
        rowKey={(r) => r.run_id}
        loading={history.isLoading}
        toolbar={
          <div className="flex items-center justify-between w-full">
            <span className="micro">Run History</span>
            {meta && meta.total > meta.page_size && (
              <span className="flex items-center gap-2 text-[12px] text-text-muted">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="disabled:opacity-30 px-1"
                >
                  ‹
                </button>
                {meta.page} / {Math.max(1, Math.ceil(meta.total / meta.page_size))}
                <button
                  disabled={!meta.has_more}
                  onClick={() => setPage((p) => p + 1)}
                  className="disabled:opacity-30 px-1"
                >
                  ›
                </button>
              </span>
            )}
          </div>
        }
        empty={{
          icon: <Inbox className="w-6 h-6" />,
          title: "No report runs yet",
          message: "Weekly Sales & Customer reports generate automatically on Saturdays at 8 PM.",
        }}
      />

      <DataTable
        columns={[
          {
            key: "name",
            header: "Template",
            render: (t) => (
              <div>
                <div className="font-medium">{t.display_name}</div>
                {t.description && (
                  <div className="text-[11px] text-text-faint">{t.description}</div>
                )}
              </div>
            ),
          },
          {
            key: "cadence",
            header: "Schedule",
            render: (t) =>
              t.cadence === "weekly" && t.scheduled_day_of_week !== null
                ? `Weekly · ${WEEKDAYS[t.scheduled_day_of_week]}${
                    t.scheduled_hour !== null ? ` ${t.scheduled_hour}:00` : ""
                  }`
                : t.cadence,
          },
          {
            key: "last",
            header: "Last Run",
            render: (t) => (t.last_run_at ? t.last_run_at.slice(0, 10) : "—"),
          },
          {
            key: "next",
            header: "Next Run",
            render: (t) => (t.next_run_at ? t.next_run_at.slice(0, 10) : "—"),
          },
          {
            key: "active",
            header: "Status",
            render: (t) => (
              <Pill tone={t.is_active ? "success" : "neutral"}>
                {t.is_active ? "active" : "paused"}
              </Pill>
            ),
          },
        ]}
        rows={templates.data ?? []}
        rowKey={(t) => t.template_id}
        loading={templates.isLoading}
        toolbar={
          <span className="micro flex items-center gap-2">
            <CalendarClock className="w-3.5 h-3.5" /> Scheduled Templates
          </span>
        }
        empty={{
          icon: <CalendarClock className="w-6 h-6" />,
          title: "No scheduled templates",
        }}
      />
    </div>
  );
}

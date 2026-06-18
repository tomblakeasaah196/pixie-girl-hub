import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { Button, Card, Pill, type Tone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog, ErrorState, MultiSelect, Select, Toggle } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Field, TextInput } from "@/components/ui/Form";
import {
  useScheduledReports,
  useCreateReport,
  useUpdateReport,
  useDeleteReport,
  type ScheduledReport,
} from "@/lib/settings";

/**
 * Settings → Scheduled reports. List of reports that run on a schedule or
 * fire on a module event. Inline active toggle, delete via confirm, and a
 * drawer to create a new report.
 */

const SOURCE_MODULES = ["sales", "invoicing", "accounting", "stock", "hr"] as const;
const CADENCES = ["daily", "weekly", "monthly", "quarterly", "on_event"] as const;
const FORMATS = ["pdf", "csv", "xlsx"] as const;

type Cadence = (typeof CADENCES)[number];
type SourceModule = (typeof SOURCE_MODULES)[number];
type Format = (typeof FORMATS)[number];

const CADENCE_TONE: Record<Cadence, Tone> = {
  daily: "accent",
  weekly: "info",
  monthly: "info",
  quarterly: "neutral",
  on_event: "warn",
};

export function ScheduledReportsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Scheduled Reports" }]);
  const query = useScheduledReports();
  const create = useCreateReport();
  const update = useUpdateReport();
  const del = useDeleteReport();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ScheduledReport | null>(null);

  const [name, setName] = useState("");
  const [sourceModule, setSourceModule] = useState<SourceModule>("sales");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [recipients, setRecipients] = useState("");
  const [formats, setFormats] = useState<Format[]>(["pdf"]);

  const rows = query.data ?? [];

  const resetForm = () => {
    setName("");
    setSourceModule("sales");
    setTriggerEvent("");
    setCadence("monthly");
    setRecipients("");
    setFormats(["pdf"]);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    resetForm();
  };

  const parsedRecipients = recipients
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const canSave = name.trim() && formats.length > 0;
  const submit = () => {
    if (!canSave) return;
    create.mutate(
      {
        name: name.trim(),
        source_module: sourceModule,
        trigger_event: triggerEvent.trim() || null,
        cadence,
        recipients: parsedRecipients,
        formats,
      },
      { onSuccess: closeDrawer },
    );
  };

  const columns: Column<ScheduledReport>[] = [
    { key: "name", header: "Name", render: (r) => <span className="font-semibold">{r.name}</span> },
    { key: "source_module", header: "Source", render: (r) => <span className="text-text-muted capitalize">{r.source_module}</span> },
    { key: "cadence", header: "Cadence", render: (r) => <Pill tone={CADENCE_TONE[r.cadence] ?? "neutral"}>{r.cadence.replace("_", " ")}</Pill> },
    { key: "recipients", header: "Recipients", align: "right", render: (r) => <span className="tabular-nums text-text-muted">{r.recipients.length}</span> },
    {
      key: "formats",
      header: "Formats",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.formats.map((f) => (
            <span key={f} className="px-2 py-0.5 rounded-[7px] text-[10.5px] font-bold uppercase bg-text-primary/[0.06] text-text-muted">
              {f}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "next_run_at",
      header: "Next run",
      render: (r) => (
        <span className="text-text-muted">
          {r.next_run_at ? new Date(r.next_run_at).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "is_active",
      header: "Active",
      render: (r) => (
        <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Toggle
            checked={r.is_active}
            disabled={update.isPending}
            onChange={(is_active) => update.mutate({ id: r.report_id, patch: { is_active } })}
          />
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setToDelete(r);
          }}
          className="inline-flex items-center justify-center w-8 h-8 rounded-[9px] text-text-muted hover:text-danger hover:bg-danger/10"
          aria-label="Delete report"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      ),
    },
  ];

  if (query.isError) {
    return (
      <div className="max-w-[1040px] mx-auto">
        <Card className="overflow-hidden">
          <ErrorState message="We couldn't load scheduled reports." onRetry={() => query.refetch()} />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1040px] mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-xl font-medium">Scheduled reports</h2>
          <p className="text-[13px] text-text-muted mt-0.5">
            Reports can run on a schedule or fire on a module event (set Trigger event).
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
          New report
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.report_id}
        loading={query.isLoading}
        empty={{
          icon: <CalendarClock className="w-7 h-7" />,
          title: "No scheduled reports",
          message: "Create a report to deliver on a cadence or when a module event fires.",
          action: (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
              New report
            </Button>
          ),
        }}
      />

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        wide
        title="New scheduled report"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>Cancel</Button>
            <Button variant="primary" disabled={!canSave || create.isPending} onClick={submit}>
              {create.isPending ? "Creating…" : "Create report"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly sales summary" />
          </Field>
          <Field label="Source module">
            <Select
              value={sourceModule}
              onChange={setSourceModule}
              options={SOURCE_MODULES.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
            />
          </Field>
          <Field label="Cadence">
            <Select
              value={cadence}
              onChange={setCadence}
              options={CADENCES.map((c) => ({ value: c, label: c.replace("_", " ") }))}
            />
          </Field>
          <Field label="Trigger event" hint="optional — fires the report on this module event">
            <TextInput value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="invoice.paid" />
          </Field>
          <Field label="Recipients" hint="comma-separated emails">
            <TextInput value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ada@pixiegirl.ng, finance@pixiegirl.ng" />
          </Field>
          <Field label="Formats">
            <MultiSelect
              values={formats}
              onChange={setFormats}
              options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Field>
          {create.isError && (
            <p className="text-[12px] text-danger">
              {create.error instanceof Error ? create.error.message : "Failed to create report"}
            </p>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete.report_id, { onSuccess: () => setToDelete(null) })}
        title="Delete report"
        message={<>Delete the report <strong>{toDelete?.name}</strong>? This cannot be undone.</>}
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </div>
  );
}

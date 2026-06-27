import { useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { exportSalesReport } from "./api";
import { ORDER_STATUS_OPTIONS, SALES_CHANNELS } from "./constants";

type Preset = "this_month" | "last_month" | "this_year" | "last_30" | "all" | "custom";

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

const CHANNEL_OPTIONS = [
  { value: "", label: "All channels" },
  ...SALES_CHANNELS.map((c) => ({ value: c.value as string, label: c.label })),
];

/** Local YYYY-MM-DD (avoids UTC drift from toISOString). */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

/** Resolve a preset to an inclusive { from, to } pair (undefined = unbounded). */
function presetRange(preset: Preset): { from?: string; to?: string } {
  const now = new Date();
  const today = ymd(now);
  switch (preset) {
    case "this_month":
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: ymd(first), to: ymd(last) };
    }
    case "last_30": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { from: ymd(start), to: today };
    }
    case "this_year":
      return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: today };
    case "all":
      return {};
    case "custom":
      return {};
  }
}

export function SalesReportExportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === "custom") {
      return { from: customFrom || undefined, to: customTo || undefined };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const invalidCustom =
    preset === "custom" &&
    !!range.from &&
    !!range.to &&
    range.from > range.to;

  async function handleDownload() {
    setError(null);
    if (invalidCustom) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setBusy(true);
    try {
      await exportSalesReport({
        from: range.from,
        to: range.to,
        status: status || undefined,
        sales_channel: channel || undefined,
      });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not generate the report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const periodLabel =
    range.from || range.to
      ? `${range.from ?? "Beginning"} → ${range.to ?? "Today"}`
      : "All orders (no date limit)";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <span className="inline-flex items-center gap-2">
          <FileSpreadsheet className="w-[18px] h-[18px] text-accent" />
          Export Sales Report
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleDownload}
            disabled={busy || invalidCustom}
            icon={<Download className="w-4 h-4" />}
          >
            {busy ? "Generating…" : "Download Excel"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-text-muted">
          Generates a styled Excel workbook (Summary, Orders, Order Items,
          Payments) for the selected period.
        </p>

        <div>
          <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
            Period
          </label>
          <Select<Preset>
            value={preset}
            onChange={setPreset}
            options={PRESET_OPTIONS}
          />
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
                From
              </label>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full h-[42px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
                To
              </label>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full h-[42px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
              Status
            </label>
            <Select
              value={status}
              onChange={setStatus}
              options={ORDER_STATUS_OPTIONS as { value: string; label: string }[]}
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-text-muted mb-1.5">
              Channel
            </label>
            <Select value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
          </div>
        </div>

        <div className="rounded-[11px] bg-text-primary/[0.03] border border-line px-3 py-2.5 text-[12px] text-text-muted">
          <span className="font-semibold text-text-primary">Period:</span>{" "}
          {periodLabel}
        </div>

        {error && (
          <p className="text-[12px] text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

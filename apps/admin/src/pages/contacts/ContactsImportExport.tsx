import { useEffect, useRef, useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  Download,
  ChevronDown,
  Users,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import { UploadProgress } from "@/components/ui/UploadProgress";
import { useUploadProgress } from "@/lib/use-upload";
import {
  contactsTemplatePath,
  contactsExportPath,
  importContacts,
  type ContactImportKind,
  type ContactImportResult,
} from "./api";

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const KIND_ITEMS: {
  kind: ContactImportKind;
  label: string;
  icon: typeof Users;
}[] = [
  { kind: "clients", label: "Clients", icon: Users },
  { kind: "suppliers", label: "Suppliers", icon: Truck },
];

/**
 * Bulk import/export controls for the Contacts directory.
 *
 *  • Template — a dropdown (Clients / Suppliers); each downloads a CSV with the
 *    column headers + one sample row.
 *  • Import   — a dropdown (Clients / Suppliers); picks a filled CSV/Excel file
 *    and bulk-creates contacts, then shows a per-row summary.
 *  • Export   — OWNER (CEO) ONLY: pick a period and download a CSV. Hidden for
 *    everyone else (the API hard-gates it too).
 */
export function ContactsImportExport({
  onImported,
}: {
  onImported?: () => void;
}) {
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<ContactImportKind>("clients");

  const [busy, setBusy] = useState<null | "template" | "import" | "export">(
    null,
  );
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const { progress, run } = useUploadProgress();

  const downloadTemplate = async (kind: ContactImportKind) => {
    setBusy("template");
    setError(null);
    try {
      await api.download(contactsTemplatePath(kind), `${kind}-template.csv`);
    } catch {
      setError("Template download failed — check your connection and retry.");
    } finally {
      setBusy(null);
    }
  };

  const startImport = (kind: ContactImportKind) => {
    pendingKind.current = kind;
    fileRef.current?.click();
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("import");
    setError(null);
    try {
      const res = await run((onProgress) =>
        importContacts(pendingKind.current, file, onProgress),
      );
      setResult(res);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <MenuButton
          label="Template"
          icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
          variant="ghost"
          busy={busy === "template"}
          disabled={busy !== null}
          items={KIND_ITEMS.map((it) => ({
            key: it.kind,
            label: it.label,
            icon: <it.icon className="w-4 h-4" />,
            onSelect: () => downloadTemplate(it.kind),
          }))}
        />

        <MenuButton
          label="Import"
          icon={<Upload className="w-3.5 h-3.5" />}
          variant="secondary"
          busy={busy === "import"}
          busyLabel="Importing…"
          disabled={busy !== null}
          items={KIND_ITEMS.map((it) => ({
            key: it.kind,
            label: it.label,
            icon: <it.icon className="w-4 h-4" />,
            onSelect: () => startImport(it.kind),
          }))}
        />

        {isCeo && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="w-3.5 h-3.5" />}
            disabled={busy !== null}
            onClick={() => setExportOpen(true)}
          >
            Export
          </Button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={onPick}
        />
      </div>

      {busy === "import" && (
        <UploadProgress value={progress} label="Importing…" className="mt-2" />
      )}
      {error && <p className="text-[11.5px] text-danger mt-1">{error}</p>}

      {isCeo && exportOpen && (
        <ExportModal
          onClose={() => setExportOpen(false)}
          busy={busy === "export"}
          setBusy={(b) => setBusy(b ? "export" : null)}
        />
      )}

      <ImportResultModal result={result} onClose={() => setResult(null)} />
    </>
  );
}

// ── Owner-only export modal (pick a period) ──────────────────────────────
function ExportModal({
  onClose,
  busy,
  setBusy,
}: {
  onClose: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [kind, setKind] = useState<"all" | "clients" | "suppliers">("all");
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoToday());
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (from && to && from > to) {
      setError("The start date can't be after the end date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.download(
        contactsExportPath({ kind, from, to }),
        "contacts.csv",
      );
      onClose();
    } catch {
      setError("Export failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Export contacts"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={run}
            disabled={busy}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            {busy ? "Exporting…" : "Export CSV"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12.5px] text-text-muted">
          Owner-only. Pick the records and a period — the export downloads as a
          CSV you can open in Excel.
        </p>
        <Field label="Records">
          <Select
            value={kind}
            onChange={(v) => setKind(v as typeof kind)}
            options={[
              { value: "all", label: "Clients & suppliers" },
              { value: "clients", label: "Clients only" },
              { value: "suppliers", label: "Suppliers only" },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <DateInput value={from} onChange={setFrom} max={to || undefined} />
          </Field>
          <Field label="To">
            <DateInput value={to} onChange={setTo} min={from || undefined} />
          </Field>
        </div>
        <p className="text-[11px] text-text-faint">
          Leave both dates blank to export everything.
        </p>
        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium text-text-muted mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

function DateInput({
  value,
  onChange,
  min,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-[36px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors [color-scheme:dark]"
    />
  );
}

// ── Import result summary ────────────────────────────────────────────────
function ImportResultModal({
  result,
  onClose,
}: {
  result: ContactImportResult | null;
  onClose: () => void;
}) {
  const problems = (result?.results ?? []).filter(
    (r) => r.status !== "created",
  );
  return (
    <Modal
      open={!!result}
      onClose={onClose}
      title={`Import ${result?.kind ?? "contacts"}`}
    >
      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span className="text-success font-semibold">
              {result.created} created
            </span>
            {result.duplicates > 0 && (
              <span className="text-accent-glow font-semibold">
                {result.duplicates} already on file
              </span>
            )}
            <span className="text-text-faint">{result.total} rows read</span>
          </div>
          {problems.length > 0 && (
            <div className="max-h-[280px] overflow-y-auto rounded-[10px] border border-line divide-y divide-line/60">
              {problems.map((p, i) => (
                <div key={i} className="px-3 py-2 text-[12px]">
                  <span className="text-text-faint">row {p.row ?? "?"}</span>{" "}
                  <span
                    className={cn(
                      "font-medium",
                      p.status === "error"
                        ? "text-danger"
                        : p.status === "duplicate"
                          ? "text-accent-glow"
                          : "text-warn",
                    )}
                  >
                    {p.status}
                  </span>
                  {p.name ? ` — ${p.name}` : ""}
                  {p.reason ? `: ${p.reason}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Small split-style menu button (glass dropdown) ───────────────────────
function MenuButton({
  label,
  icon,
  variant,
  items,
  busy,
  busyLabel,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  variant: "ghost" | "secondary";
  items: {
    key: string;
    label: string;
    icon?: React.ReactNode;
    onSelect: () => void;
  }[];
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        variant={variant}
        icon={icon}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? (busyLabel ?? "…") : label}
        <ChevronDown
          className={cn(
            "w-3 h-3 -mr-1 transition-transform",
            open && "rotate-180",
          )}
        />
      </Button>
      {open && (
        <div className="absolute right-0 z-[70] mt-1.5 min-w-[180px] p-1.5 rounded-[14px] dropglass animate-fade-in">
          <p className="px-2.5 pt-1 pb-1.5 text-[10.5px] uppercase tracking-wide text-text-faint">
            {label}
          </p>
          {items.map((it) => (
            <button
              key={it.key}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className="w-full flex items-center gap-2.5 p-[8px_10px] rounded-[10px] text-[13px] font-medium text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-all"
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

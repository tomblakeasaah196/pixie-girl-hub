import { useEffect, useRef, useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  Download,
  ChevronDown,
  Users,
  Truck,
  Store,
  Scissors,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import { ContactBulkImportModal } from "./ContactBulkImportModal";
import {
  contactsTemplatePath,
  contactsExportPath,
  type ContactImportKind,
} from "./api";

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const KIND_ITEMS: {
  kind: ContactImportKind;
  label: string;
  icon: LucideIcon;
}[] = [
  { kind: "clients", label: "Clients", icon: Users },
  { kind: "suppliers", label: "Suppliers", icon: Truck },
  { kind: "retail_partners", label: "Retail partners", icon: Store },
  { kind: "stylists", label: "Stylists", icon: Scissors },
  { kind: "subscribers", label: "Subscribers", icon: Bell },
];

/**
 * Bulk import/export controls for the Contacts directory.
 *
 *  • Import   — opens the guided engine (pick a kind → template → preview →
 *    confirm). One modal, five stakeholder kinds; see ContactBulkImportModal.
 *  • Template — a quick per-kind CSV download (also available inside the modal).
 *  • Export   — OWNER (CEO) ONLY: pick a period and download a CSV. Hidden for
 *    everyone else (the API hard-gates it too).
 */
export function ContactsImportExport({
  onImported,
  onOpenModal,
  variant = "toolbar",
}: {
  onImported?: () => void;
  /** Fired when a tool that opens a full-screen modal (Import / Export) is
   *  launched. When this component lives inside the Add bottom-sheet, the parent
   *  passes its close handler here so the sheet steps out of the way — otherwise
   *  the import/export modal would stack behind it. */
  onOpenModal?: () => void;
  /** "toolbar" = inline buttons (default). "sheet" = flat tiles, for use inside
   *  the Add bottom-sheet where absolute dropdowns would be clipped. */
  variant?: "toolbar" | "sheet";
}) {
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);

  const [busy, setBusy] = useState<null | "template" | "export">(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Sheet variant: whether the Template kind-chooser is expanded.
  const [templateOpen, setTemplateOpen] = useState(false);

  // Opening either full-screen tool closes the host sheet (if any) so the
  // modal is never stacked behind it, then shows the tool.
  const openImport = () => {
    setTemplateOpen(false);
    onOpenModal?.();
    setImportOpen(true);
  };
  const openExport = () => {
    setTemplateOpen(false);
    onOpenModal?.();
    setExportOpen(true);
  };

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

  // Sheet variant — flat tiles (Import · Export · Template) with an inline
  // template kind-chooser, so it drops cleanly into the Add bottom-sheet.
  const sheetControls = (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <SheetTile
          icon={<Upload className="w-[18px] h-[18px]" />}
          label="Import"
          disabled={busy !== null}
          onClick={openImport}
        />
        {isCeo && (
          <SheetTile
            icon={<Download className="w-[18px] h-[18px]" />}
            label="Export"
            disabled={busy !== null}
            onClick={openExport}
          />
        )}
        <SheetTile
          icon={<FileSpreadsheet className="w-[18px] h-[18px]" />}
          label="Template"
          active={templateOpen}
          busy={busy === "template"}
          disabled={busy !== null}
          onClick={() => setTemplateOpen((t) => !t)}
        />
      </div>

      {templateOpen && (
        <div className="mt-2.5 p-2.5 rounded-[11px] bg-text-primary/[0.04] border hairline">
          <span className="micro block mb-2">Template for which records?</span>
          <div className="flex flex-wrap gap-1.5">
            {KIND_ITEMS.map((it) => (
              <button
                key={it.kind}
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setTemplateOpen(false);
                  downloadTemplate(it.kind);
                }}
                className="inline-flex items-center gap-1.5 h-[30px] px-3 rounded-[9px] text-[12px] font-semibold bg-text-primary/[0.05] border border-line text-text-primary hover:bg-text-primary/[0.1] transition-colors disabled:opacity-50"
              >
                <it.icon className="w-3.5 h-3.5" />
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const toolbarControls = (
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

      <Button
        size="sm"
        variant="secondary"
        icon={<Upload className="w-3.5 h-3.5" />}
        disabled={busy !== null}
        onClick={openImport}
      >
        Import
      </Button>

      {isCeo && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Download className="w-3.5 h-3.5" />}
          disabled={busy !== null}
          onClick={openExport}
        >
          Export
        </Button>
      )}
    </div>
  );

  return (
    <>
      {variant === "sheet" ? sheetControls : toolbarControls}

      {error && <p className="text-[11.5px] text-danger mt-1">{error}</p>}

      <ContactBulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={onImported}
      />

      {isCeo && exportOpen && (
        <ExportModal
          onClose={() => setExportOpen(false)}
          busy={busy === "export"}
          setBusy={(b) => setBusy(b ? "export" : null)}
        />
      )}
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

// ── Sheet tile (flat, no dropdown — safe inside an overflow-clipped sheet) ──
function SheetTile({
  icon,
  label,
  onClick,
  active,
  busy,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-3.5 rounded-[14px] border transition-colors disabled:opacity-50",
        active
          ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
          : "bg-text-primary/[0.03] border-line text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary",
      )}
    >
      <span className={busy ? "animate-pulse" : undefined}>{icon}</span>
      <span className="text-[12px] font-semibold">{busy ? "…" : label}</span>
    </button>
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

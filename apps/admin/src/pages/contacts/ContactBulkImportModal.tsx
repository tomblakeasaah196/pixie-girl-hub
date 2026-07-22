import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  ChevronRight,
  Users,
  Truck,
  Store,
  Scissors,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Pill } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import {
  contactsTemplatePath,
  getImportSpec,
  importContactRows,
  type ContactImportKind,
  type ContactImportResult,
  type ImportSpec,
} from "./api";

/**
 * Bulk-import contacts from an Excel/CSV sheet — one engine, five stakeholder
 * kinds. Modelled on Catalogue → Base Products "Import" (canon §5 — glass
 * overlay, four states): PICK a kind · CHOOSE a file · PREVIEW every row ·
 * CONFIRM. Each kind carries its own template, preview columns and confirm.
 *
 * The sheet is parsed entirely in the browser (SheetJS) so the operator can
 * REVIEW before anything is written; on confirm the parsed rows are posted to
 * /contacts/import-rows. The column model is served by the backend
 * (/contacts/import-spec) so the preview validation matches the server without
 * a hard-coded copy — de-dupe on phone/email and per-row errors are reported by
 * the server in the result.
 */

type KindMeta = {
  kind: ContactImportKind;
  label: string;
  blurb: string;
  icon: LucideIcon;
};

// Kinds the engine offers. Employees onboard through HR (role/schedule/pay), so
// they're intentionally absent here — see the Contacts onboarding wizard.
const KINDS: KindMeta[] = [
  {
    kind: "clients",
    label: "Clients",
    blurb: "Customers — personal details, socials & delivery address.",
    icon: Users,
  },
  {
    kind: "suppliers",
    label: "Suppliers",
    blurb: "Vendors you buy from — company, TIN & CAC.",
    icon: Truck,
  },
  {
    kind: "retail_partners",
    label: "Retail partners",
    blurb: "Stores that resell — business details & socials.",
    icon: Store,
  },
  {
    kind: "stylists",
    label: "Stylists",
    blurb: "Stylist partners — personal details & socials.",
    icon: Scissors,
  },
  {
    kind: "subscribers",
    label: "Subscribers",
    blurb: "Newsletter sign-ups — name and a way to reach them.",
    icon: Bell,
  },
];
const kindMeta = (k: ContactImportKind) =>
  KINDS.find((m) => m.kind === k) ?? KINDS[0];

type ParsedRow = {
  /** Canonical header→value map, sent verbatim on confirm. */
  raw: Record<string, string>;
  name: string;
  phone: string;
  email: string;
  company: string;
  error: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parse a sheet against a kind's column spec → previewable, validated rows. */
async function parseSheet(file: File, spec: ImportSpec): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  // raw:false → dates/numbers come as their displayed strings (no Excel serials).
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });

  const byNorm = new Map(spec.columns.map((c) => [norm(c.header), c.header]));
  const required = spec.columns.filter((c) => c.required);
  const channels = spec.columns.filter((c) => c.channel);
  const nameHeader =
    spec.columns.find((c) => c.required && c.type === "text")?.header ??
    spec.columns[0]?.header;
  const phoneHeader = spec.columns.find((c) => c.type === "phone")?.header;
  const emailHeader = spec.columns.find((c) => c.type === "email")?.header;
  const companyHeader = spec.columns.find(
    (c) => c.field === "company_name",
  )?.header;

  return json
    .map((rawRow): ParsedRow => {
      const canon: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawRow)) {
        const header = byNorm.get(norm(k));
        if (!header) continue; // unknown column → ignored, never fatal
        const val = v == null ? "" : String(v).trim();
        if (val) canon[header] = val;
      }

      let error: string | null = null;
      for (const c of required) {
        if (!canon[c.header]) {
          error = `Missing ${c.header.replace(/\*$/, "")}`;
          break;
        }
      }
      if (!error && channels.length && !channels.some((c) => canon[c.header])) {
        error = "Add a phone or email";
      }

      return {
        raw: canon,
        name: nameHeader ? (canon[nameHeader] ?? "") : "",
        phone: phoneHeader ? (canon[phoneHeader] ?? "") : "",
        email: emailHeader ? (canon[emailHeader] ?? "") : "",
        company: companyHeader ? (canon[companyHeader] ?? "") : "",
        error,
      };
    })
    .filter((r) => Object.keys(r.raw).length > 0);
}

export function ContactBulkImportModal({
  open,
  onClose,
  onImported,
  initialKind = null,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  /** Skip the kind picker and open straight into a kind. */
  initialKind?: ContactImportKind | null;
}) {
  const [kind, setKind] = useState<ContactImportKind | null>(initialKind);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<ContactImportResult | null>(null);

  const spec = useQuery({
    queryKey: ["contacts", "import-spec", kind],
    queryFn: () => getImportSpec(kind as ContactImportKind),
    enabled: !!kind,
    staleTime: 5 * 60_000,
  });

  const imp = useMutation({
    mutationFn: (payload: Record<string, string>[]) =>
      importContactRows(kind as ContactImportKind, payload),
    onSuccess: (res) => {
      setResult(res);
      onImported?.();
    },
  });

  const resetFile = useCallback(() => {
    setFileName("");
    setRows(null);
    setParsing(false);
    setParseError(null);
    setDragOver(false);
    setResult(null);
    imp.reset();
    if (fileRef.current) fileRef.current.value = "";
  }, [imp]);

  const resetAll = useCallback(() => {
    resetFile();
    setKind(initialKind);
  }, [resetFile, initialKind]);

  const close = useCallback(() => {
    if (imp.isPending) return; // don't drop an in-flight import
    onClose();
    setTimeout(resetAll, 250); // defer so the closing transition stays clean
  }, [imp.isPending, onClose, resetAll]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Re-sync to a fresh preset each time the modal is (re)opened.
  useEffect(() => {
    if (open) setKind((k) => k ?? initialKind);
  }, [open, initialKind]);

  const ingest = useCallback(
    async (file: File | undefined) => {
      if (!file || !spec.data) return;
      setParsing(true);
      setParseError(null);
      setResult(null);
      setFileName(file.name);
      try {
        const parsed = await parseSheet(file, spec.data);
        if (parsed.length === 0) {
          setParseError(
            "No rows found. Make sure the first row is the column headers.",
          );
          setRows(null);
        } else {
          setRows(parsed);
        }
      } catch (e) {
        setParseError(
          e instanceof Error ? e.message : "Could not read that file.",
        );
        setRows(null);
      } finally {
        setParsing(false);
      }
    },
    [spec.data],
  );

  const downloadTemplate = useCallback(async () => {
    if (!kind) return;
    setDownloading(true);
    try {
      await api.download(contactsTemplatePath(kind), `${kind}-template.csv`);
    } catch {
      setParseError("Template download failed — check your connection.");
    } finally {
      setDownloading(false);
    }
  }, [kind]);

  const valid = useMemo(() => (rows ?? []).filter((r) => !r.error), [rows]);
  const invalidCount = (rows?.length ?? 0) - valid.length;

  const runImport = () => {
    if (valid.length === 0) return;
    imp.mutate(valid.map((r) => r.raw));
  };

  const meta = kind ? kindMeta(kind) : null;

  const subtitle = result
    ? "Import complete"
    : rows
      ? `${rows.length} row${rows.length === 1 ? "" : "s"} read`
      : kind
        ? "Excel (.xlsx) or CSV"
        : "Choose what to import";

  return createPortal(
    <div
      className={cn(
        // z-[120]: this modal is opened from inside the "Add a contact" sheet,
        // which is a shared Modal at z-[110]. Sit above it (and we also close
        // that sheet on open) so the import flow is never rendered behind it.
        "fixed inset-0 z-[120] grid place-items-center p-4 bg-black/50 backdrop-blur-[3px] transition-[opacity,visibility] duration-300",
        open ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none",
      )}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-[min(880px,96vw)] max-h-[90vh] flex flex-col dropglass rounded-[18px] overflow-hidden transition-transform duration-300 ease-brand",
          open ? "scale-100" : "scale-95",
        )}
      >
        <div className="flex items-center gap-3 p-5 border-b hairline">
          {kind && !result && !rows && !initialKind ? (
            <IconButton
              onClick={() => {
                setKind(null);
                resetFile();
              }}
              aria-label="Back to type"
              disabled={imp.isPending}
            >
              <ArrowLeft className="w-[18px] h-[18px]" />
            </IconButton>
          ) : (
            <FileSpreadsheet className="w-5 h-5 text-accent-glow" />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-medium leading-tight">
              {meta ? `Import ${meta.label.toLowerCase()}` : "Import contacts"}
            </h2>
            <div className="micro mt-0.5">{subtitle}</div>
          </div>
          <IconButton onClick={close} aria-label="Close" disabled={imp.isPending}>
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!kind ? (
            <KindPicker onPick={(k) => setKind(k)} />
          ) : result ? (
            <ResultView result={result} />
          ) : rows ? (
            <PreviewView
              rows={rows}
              invalidCount={invalidCount}
              validCount={valid.length}
            />
          ) : (
            <ChooseView
              spec={spec.data ?? null}
              specLoading={spec.isLoading}
              specError={spec.isError}
              parsing={parsing}
              parseError={parseError}
              fileName={fileName}
              dragOver={dragOver}
              onPick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void ingest(e.dataTransfer.files?.[0]);
              }}
            />
          )}

          {imp.isError && !result && (
            <p className="mt-4 text-[12.5px] text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {imp.error instanceof Error
                ? imp.error.message
                : "Import failed. No contacts were created."}
            </p>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => void ingest(e.target.files?.[0])}
          />
        </div>

        <div className="p-[14px_20px] border-t hairline flex items-center gap-2">
          {kind && !result && (
            <Button
              variant="ghost"
              size="sm"
              icon={
                downloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )
              }
              onClick={downloadTemplate}
              disabled={downloading}
            >
              {meta ? `${meta.label} template` : "CSV template"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {result ? (
              <>
                <Button size="sm" variant="ghost" onClick={resetFile}>
                  Import more
                </Button>
                <Button size="sm" variant="primary" onClick={close}>
                  Done
                </Button>
              </>
            ) : rows ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetFile}
                  disabled={imp.isPending}
                >
                  Choose another file
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={valid.length === 0 || imp.isPending}
                  onClick={runImport}
                  icon={
                    imp.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : undefined
                  }
                >
                  {imp.isPending
                    ? "Importing…"
                    : `Import ${valid.length} ${
                        valid.length === 1 ? "record" : "records"
                      }`}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Step 0 · pick a kind ───────────────────────────────── */
function KindPicker({ onPick }: { onPick: (k: ContactImportKind) => void }) {
  return (
    <div>
      <p className="text-[12.5px] text-text-muted mb-4">
        What kind of records are you importing? Each has its own template, review
        and confirm — pick one to continue.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {KINDS.map((m) => (
          <button
            key={m.kind}
            type="button"
            onClick={() => onPick(m.kind)}
            className="group flex items-center gap-3 text-left p-3.5 rounded-[14px] border border-line bg-text-primary/[0.02] hover:border-accent/40 hover:bg-accent/[0.05] transition-colors"
          >
            <span className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent-deep/[0.14] text-accent-glow shrink-0">
              <m.icon className="w-5 h-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-text-primary">
                {m.label}
              </span>
              <span className="block text-[11.5px] text-text-faint leading-snug mt-0.5">
                {m.blurb}
              </span>
            </span>
            <ChevronRight className="w-4 h-4 text-text-faint group-hover:text-accent-glow transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Step 1 · choose / drop a file ──────────────────────── */
function ChooseView({
  spec,
  specLoading,
  specError,
  parsing,
  parseError,
  fileName,
  dragOver,
  onPick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  spec: ImportSpec | null;
  specLoading: boolean;
  specError: boolean;
  parsing: boolean;
  parseError: string | null;
  fileName: string;
  dragOver: boolean;
  onPick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onPick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        disabled={!spec}
        className={cn(
          "w-full rounded-[14px] border border-dashed p-8 grid place-items-center text-center transition-colors disabled:opacity-60",
          dragOver
            ? "border-accent/60 bg-accent/[0.06]"
            : "border-line bg-text-primary/[0.02] hover:border-accent/40",
        )}
      >
        {parsing || specLoading ? (
          <Loader2 className="w-7 h-7 text-accent-glow animate-spin" />
        ) : (
          <Upload className="w-7 h-7 text-text-faint" />
        )}
        <div className="mt-3 text-[13.5px] font-semibold text-text-primary">
          {parsing
            ? "Reading sheet…"
            : specLoading
              ? "Preparing…"
              : fileName || "Drop your sheet here, or click to choose"}
        </div>
        <div className="mt-1 text-[11.5px] text-text-faint">
          Excel (.xlsx) or CSV · up to 5000 rows
        </div>
      </button>

      {(parseError || specError) && (
        <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {parseError ??
            "Couldn't load the template columns — retry in a moment."}
        </p>
      )}

      {spec && (
        <div className="mt-5 rounded-[12px] border hairline p-4 bg-text-primary/[0.02]">
          <div className="micro mb-2">Expected columns</div>
          <div className="flex flex-wrap gap-1.5">
            {spec.columns.map((c) => (
              <span
                key={c.header}
                className={cn(
                  "text-[11px] font-semibold px-2 py-1 rounded-[8px] bg-text-primary/[0.06] text-text-muted",
                  c.required && "text-accent-glow bg-accent/[0.1]",
                )}
              >
                {c.header}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-text-faint leading-relaxed">
            Download the template for the exact layout. Headers are matched
            loosely, so minor spelling differences are fine. Every contact needs
            a <span className="text-text-muted">name</span> and at least a{" "}
            <span className="text-text-muted">phone or email</span>. A row whose
            phone or email is already on file is{" "}
            <span className="text-text-muted">skipped</span> (their type is
            unioned in), never duplicated.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Step 2 · preview ───────────────────────────────────── */
const PREVIEW_CAP = 200;
function PreviewView({
  rows,
  invalidCount,
  validCount,
}: {
  rows: ParsedRow[];
  invalidCount: number;
  validCount: number;
}) {
  const shown = rows.slice(0, PREVIEW_CAP);
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Pill tone="success" dot={false}>
          {validCount} ready
        </Pill>
        {invalidCount > 0 && (
          <Pill tone="danger" dot={false}>
            {invalidCount} to fix
          </Pill>
        )}
        <span className="text-[11.5px] text-text-faint ml-auto">
          Duplicates are detected on import
        </span>
      </div>

      <div className="rounded-[12px] border hairline overflow-hidden">
        <div className="max-h-[46vh] overflow-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface/95 backdrop-blur text-text-faint">
                <th className="text-left font-semibold px-3 py-2 w-9">#</th>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-left font-semibold px-3 py-2">Phone</th>
                <th className="text-left font-semibold px-3 py-2">Email</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-t hairline",
                    r.error && "bg-danger/[0.05]",
                  )}
                >
                  <td className="px-3 py-2 text-text-faint tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 text-text-primary max-w-[220px] truncate">
                    {r.name || r.company || (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted tabular-nums max-w-[150px] truncate">
                    {r.phone || "—"}
                  </td>
                  <td className="px-3 py-2 text-text-muted max-w-[200px] truncate">
                    {r.email || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.error ? (
                      <span className="text-danger text-[11px] font-semibold">
                        {r.error}
                      </span>
                    ) : (
                      <span className="text-success text-[11px] font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Ready
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rows.length > PREVIEW_CAP && (
        <p className="mt-2 text-[11.5px] text-text-faint">
          Showing first {PREVIEW_CAP} of {rows.length} rows — all valid rows will
          be imported.
        </p>
      )}
      {invalidCount > 0 && (
        <p className="mt-2 text-[11.5px] text-text-faint">
          Rows that need fixing are skipped. Correct them in the sheet and
          re-upload to include them.
        </p>
      )}
    </div>
  );
}

/* ── Step 3 · result ────────────────────────────────────── */
function ResultView({ result }: { result: ContactImportResult }) {
  const problems = (result.results ?? []).filter((r) => r.status !== "created");
  const shown = problems.slice(0, PREVIEW_CAP);
  return (
    <div>
      <div className="flex items-center gap-3 mb-3 p-3 rounded-[12px] bg-success/[0.08] border border-success/30">
        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
        <div className="text-[13px] text-text-primary">
          <span className="font-semibold">{result.created}</span> created
          {result.duplicates > 0 && (
            <>
              {" · "}
              <span className="font-semibold">{result.duplicates}</span> already
              on file
            </>
          )}
          {" · "}
          {result.total} row{result.total === 1 ? "" : "s"} read. Existing
          contacts were kept, not duplicated.
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-[12px] border hairline overflow-hidden">
          <div className="max-h-[44vh] overflow-auto divide-y divide-line/60">
            {shown.map((p, i) => (
              <div key={i} className="px-3 py-2 text-[12px]">
                <span className="text-text-faint tabular-nums">
                  row {p.row ?? "?"}
                </span>{" "}
                <Pill
                  tone={
                    p.status === "error"
                      ? "danger"
                      : p.status === "duplicate"
                        ? "accent"
                        : "warn"
                  }
                  dot={false}
                >
                  {p.status}
                </Pill>
                {p.name ? (
                  <span className="text-text-primary"> — {p.name}</span>
                ) : null}
                {p.reason ? (
                  <span className="text-text-faint">: {p.reason}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
      {problems.length > PREVIEW_CAP && (
        <p className="mt-2 text-[11.5px] text-text-faint">
          Showing first {PREVIEW_CAP} of {problems.length} notes.
        </p>
      )}
    </div>
  );
}

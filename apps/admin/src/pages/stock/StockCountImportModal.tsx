import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Pill } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useAllBaseProducts, type BaseProduct } from "@/lib/catalogue";
import { FieldLabel, TextInput } from "./parts";
import { useStockMutations } from "./hooks";
import type { StockLocation, CountImportResult, CountBlankMode } from "./types";

/**
 * Import a physical stock count from a spreadsheet.
 *
 * The counterpart to the Goods Reception importer, and deliberately its
 * opposite: reception ADDS units, a count REPLACES them. A base the system
 * thinks has 9 and the sheet counts at 2 is corrected to 2, not raised to 11.
 *
 * The browser only parses the workbook — every match, every reconciliation and
 * every interlock happens server-side (`POST /stock/adjustments/import-count`),
 * so this modal and the CLI importer can never drift apart on what a sheet
 * means. Uploading previews with `commit: false`, which writes nothing; the
 * same call with `commit: true` files ONE `count` adjustment and submits it
 * for approval. Stock does not move until an approver posts it.
 */

const COUNT_SHEET = "Stock Count";

/**
 * Key each posted row carries its true spreadsheet row number under. Must stay
 * in step with `ROW_NUMBER_KEY` in `src/modules/stock/stock.count-sheet.js`,
 * which reads it; the server falls back to array position without it.
 */
const ROW_NUMBER_KEY = "__excel_row";

/** The workbook a counter fills in: one row per base product, blank Units. */
function downloadTemplate(bases: BaseProduct[]) {
  const wb = XLSX.utils.book_new();
  const header = [
    "Product Code",
    "Product Name",
    "Colour",
    "Texture",
    "Cap Construction",
    "Size",
    "Units No.",
  ];

  // Pre-filled from the live catalogue: the counter types numbers only, and
  // nothing can come back unmatched because every row IS a real product. The
  // axes are best-effort split out of the name purely so the sheet can be
  // sorted and filtered in Excel the way the shelf is walked — the import
  // matches on the code, so a blank axis costs nothing.
  const rows = bases.map((b) => {
    const parts = splitName(b.name);
    return [
      b.product_code,
      b.name,
      parts.colour,
      parts.texture,
      parts.cap,
      parts.size,
      "",
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 46 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 8 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, COUNT_SHEET);
  XLSX.writeFile(wb, "stock-count-template.xlsx");
}

/**
 * Best-effort split of "Black 4mm Curl HD13x4 Pixie Wig - Medium" into its
 * four axes, for the template's readability columns only. Anything it can't
 * work out is left blank rather than guessed.
 */
function splitName(name: string): {
  colour: string;
  texture: string;
  cap: string;
  size: string;
} {
  const blank = { colour: "", texture: "", cap: "", size: "" };
  const m =
    /^(.*?)\s+((?:HD)?\d+\s*[x×*]\s*\d+[^-]*?)\s*(?:pixie\s+wig)?\s*[-–]\s*([A-Za-z ]+)$/i.exec(
      name.trim(),
    );
  if (!m) return blank;
  const [, head, cap, size] = m;
  // The colour is the first token unless it is a slashed/hashed code, which
  // can itself contain spaces ("T2/Dark Copper"); the texture is the rest.
  const tokens = head.trim().split(/\s+/);
  if (tokens.length < 2) return blank;
  const colourLen = /[/#]/.test(tokens[0]) ? Math.max(1, tokens.length - 1) : 1;
  return {
    colour: tokens.slice(0, colourLen).join(" "),
    texture: tokens.slice(colourLen).join(" "),
    cap: cap.trim(),
    size: size.trim(),
  };
}

/**
 * Every row of the first sheet, as header -> cell, each stamped with the row
 * number the operator sees in Excel.
 *
 * `blankrows: true` matters: by default `sheet_to_json` DROPS entirely-empty
 * rows, and this sheet uses them as separators between colour blocks. Without
 * it every row after the first gap shifts up, and the "needs attention" list
 * sends someone to the wrong line — the further down the sheet, the bigger the
 * lie. Keeping the blanks makes position match the spreadsheet again; stamping
 * the number then makes it survive the filtering below (and any future one),
 * so the empties never have to be shipped to the server.
 */
function readWorkbook(
  buf: ArrayBuffer,
): Record<string, string | number | null>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const name = wb.SheetNames.find((n) => /count/i.test(n)) ?? wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(
    ws,
    { defval: "", blankrows: true },
  );
  return (
    rows
      // Header is row 1, so the first data row is 2.
      .map((row, i) => ({ ...row, [ROW_NUMBER_KEY]: i + 2 }))
      .filter((row) =>
        Object.entries(row).some(
          ([k, v]) => k !== ROW_NUMBER_KEY && String(v ?? "").trim() !== "",
        ),
      )
  );
}

export function StockCountImportModal({
  open,
  onClose,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  locations: StockLocation[];
}) {
  const bases = useAllBaseProducts(open);
  const baseList = useMemo(() => bases.data ?? [], [bases.data]);
  const { importCount } = useStockMutations();

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<
    Record<string, string | number | null>[] | null
  >(null);
  const [preview, setPreview] = useState<CountImportResult | null>(null);
  const [filed, setFiled] = useState<CountImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // The two judgement calls, defaulted to the coherent SSOT reading: the sheet
  // is everything we hold, so a blank cell and an unmentioned product both
  // mean "none". Flipping either re-previews, so the ending total below is
  // always the total for what is currently selected.
  const [blank, setBlank] = useState<CountBlankMode>("zero");
  const [unlisted, setUnlisted] = useState<CountBlankMode>("zero");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");

  const defaultLocation = useMemo(
    () => locations.find((l) => l.is_default) ?? locations[0],
    [locations],
  );
  useEffect(() => {
    if (open && !locationId && defaultLocation)
      setLocationId(defaultLocation.location_id);
  }, [open, locationId, defaultLocation]);

  const reset = useCallback(() => {
    setFileName("");
    setRows(null);
    setPreview(null);
    setFiled(null);
    setParseError(null);
    setDragOver(false);
    setNote("");
    importCount.reset();
    if (fileRef.current) fileRef.current.value = "";
  }, [importCount]);

  const close = useCallback(() => {
    if (importCount.isPending) return;
    onClose();
    setTimeout(reset, 250);
  }, [importCount.isPending, onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  /** Reconcile without writing. Re-run whenever a decision changes. */
  const runPreview = useCallback(
    (
      sheetRows: Record<string, string | number | null>[],
      opts: { blank: CountBlankMode; unlisted: CountBlankMode },
    ) => {
      importCount.mutate(
        {
          rows: sheetRows,
          location_id: locationId || undefined,
          blank: opts.blank,
          unlisted: opts.unlisted,
          commit: false,
        },
        { onSuccess: (res) => setPreview(res) },
      );
    },
    [importCount, locationId],
  );

  const ingest = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setParseError(null);
      setPreview(null);
      setFiled(null);
      setFileName(file.name);
      try {
        const parsed = readWorkbook(await file.arrayBuffer());
        if (parsed.length === 0) {
          setParseError(
            "No rows found. Fill the 'Stock Count' sheet — a Units No. against each product.",
          );
          setRows(null);
          return;
        }
        setRows(parsed);
        runPreview(parsed, { blank, unlisted });
      } catch (e) {
        setParseError(
          e instanceof Error ? e.message : "Could not read that file.",
        );
        setRows(null);
      }
    },
    [blank, unlisted, runPreview],
  );

  const decide = (next: {
    blank?: CountBlankMode;
    unlisted?: CountBlankMode;
  }) => {
    const b = next.blank ?? blank;
    const u = next.unlisted ?? unlisted;
    setBlank(b);
    setUnlisted(u);
    if (rows) runPreview(rows, { blank: b, unlisted: u });
  };

  const file = () => {
    if (!rows || !preview || preview.blockers.length) return;
    importCount.mutate(
      {
        rows,
        location_id: locationId || undefined,
        blank,
        unlisted,
        reason: note || undefined,
        commit: true,
      },
      { onSuccess: (res) => setFiled(res) },
    );
  };

  const locationOptions = [
    ...locations.map((l) => ({
      value: l.location_id,
      label: l.display_name,
    })),
  ];

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[92] grid place-items-center p-4 bg-black/50 backdrop-blur-[3px] transition-[opacity,visibility] duration-300",
        open
          ? "opacity-100 visible"
          : "opacity-0 invisible pointer-events-none",
      )}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-[min(980px,96vw)] max-h-[90vh] flex flex-col dropglass rounded-[18px] overflow-hidden transition-transform duration-300 ease-brand",
          open ? "scale-100" : "scale-95",
        )}
      >
        <div className="flex items-center gap-3 p-5 border-b hairline">
          <FileSpreadsheet className="w-5 h-5 text-accent-glow" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-medium leading-tight">
              Import Stock Count
            </h2>
            <div className="micro mt-0.5">
              {filed
                ? "Submitted for approval"
                : preview
                  ? `${preview.summary.combinations} products read from ${fileName}`
                  : "Excel (.xlsx) or CSV — the counted number replaces the system's"}
            </div>
          </div>
          <IconButton
            onClick={close}
            aria-label="Close"
            disabled={importCount.isPending}
          >
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {filed ? (
            <FiledView result={filed} />
          ) : preview ? (
            <ReviewView
              result={preview}
              blank={blank}
              unlisted={unlisted}
              onDecide={decide}
              busy={importCount.isPending}
              note={note}
              setNote={setNote}
            />
          ) : (
            <ChooseView
              busy={importCount.isPending || bases.isLoading}
              parseError={parseError}
              fileName={fileName}
              dragOver={dragOver}
              locationId={locationId}
              setLocationId={setLocationId}
              locationOptions={locationOptions}
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

          {importCount.isError && !filed && (
            <p className="mt-4 text-[12.5px] text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {importCount.error instanceof Error
                ? importCount.error.message
                : "Import failed. No stock was changed."}
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
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={() => downloadTemplate(baseList)}
            disabled={bases.isLoading || baseList.length === 0}
          >
            Excel template
          </Button>
          <div className="ml-auto flex gap-2">
            {filed ? (
              <>
                <Button size="sm" variant="ghost" onClick={reset}>
                  Import another
                </Button>
                <Button size="sm" variant="primary" onClick={close}>
                  Done
                </Button>
              </>
            ) : preview ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={reset}
                  disabled={importCount.isPending}
                >
                  Choose another file
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={file}
                  disabled={
                    importCount.isPending ||
                    preview.blockers.length > 0 ||
                    preview.lines.length === 0
                  }
                  icon={
                    importCount.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : undefined
                  }
                >
                  Submit for Approval
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

/* ── Step 1 — choose the file ─────────────────────────── */

function ChooseView({
  busy,
  parseError,
  fileName,
  dragOver,
  locationId,
  setLocationId,
  locationOptions,
  onPick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  busy: boolean;
  parseError: string | null;
  fileName: string;
  dragOver: boolean;
  locationId: string;
  setLocationId: (v: string) => void;
  locationOptions: { value: string; label: string }[];
  onPick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 p-3 rounded-[12px] bg-info/[0.07] border border-info/25 text-[12.5px] text-text-secondary">
        <AlertTriangle className="w-4 h-4 text-info shrink-0 mt-px" />
        <span>
          A count <strong>replaces</strong> what the system holds — it does not
          add to it. Goods Reception is the one that adds. Nothing moves until
          the count is approved and posted.
        </span>
      </div>

      <div>
        <FieldLabel>Location counted</FieldLabel>
        <Select
          value={locationId}
          onChange={setLocationId}
          options={locationOptions}
        />
      </div>

      <button
        type="button"
        onClick={onPick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        disabled={busy}
        className={cn(
          "w-full rounded-[14px] border border-dashed p-8 text-center transition-colors",
          dragOver
            ? "border-accent-glow bg-accent/[0.06]"
            : "border-line hover:border-accent/40",
          busy && "opacity-60 pointer-events-none",
        )}
      >
        {busy ? (
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-text-muted" />
        ) : (
          <Upload className="w-6 h-6 mx-auto text-text-muted" />
        )}
        <p className="mt-3 text-[13px] text-text-primary">
          {fileName || "Drop the count sheet here, or click to choose"}
        </p>
        <p className="mt-1 micro">
          Download the template below for a sheet with every product already
          listed
        </p>
      </button>

      {parseError && (
        <p className="text-[12.5px] text-danger flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {parseError}
        </p>
      )}
    </div>
  );
}

/* ── Step 2 — review the variance ─────────────────────── */

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="p-3 rounded-[12px] border border-line text-center">
      <p className="micro">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-[17px] tabular-nums",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Choice({
  label,
  hint,
  value,
  onChange,
  options,
  busy,
}: {
  label: string;
  hint: string;
  value: CountBlankMode;
  onChange: (v: CountBlankMode) => void;
  options: { value: CountBlankMode; label: string }[];
  busy: boolean;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-1.5 mt-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => onChange(o.value)}
            className={cn(
              "px-3 py-1.5 rounded-[9px] text-[12.5px] border transition-colors",
              value === o.value
                ? "border-accent bg-accent/[0.1] text-text-primary"
                : "border-line text-text-muted hover:border-accent/40",
              busy && "opacity-60",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="micro mt-1.5">{hint}</p>
    </div>
  );
}

function ReviewView({
  result,
  blank,
  unlisted,
  onDecide,
  busy,
  note,
  setNote,
}: {
  result: CountImportResult;
  blank: CountBlankMode;
  unlisted: CountBlankMode;
  onDecide: (n: { blank?: CountBlankMode; unlisted?: CountBlankMode }) => void;
  busy: boolean;
  note: string;
  setNote: (v: string) => void;
}) {
  const s = result.summary;
  return (
    <div className="space-y-5">
      {/* Blockers first — this sheet cannot be filed while any remain. */}
      {result.blockers.length > 0 && (
        <div className="p-3 rounded-[12px] bg-danger/[0.08] border border-danger/30">
          <p className="text-[13px] text-text-primary font-medium flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
            This sheet can&apos;t be filed yet
          </p>
          <ul className="mt-1.5 ml-6 list-disc text-[12.5px] text-text-secondary space-y-0.5">
            {result.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {unlisted === "zero" && result.unmatched.length > 0 && (
            <p className="mt-2 ml-6 text-[12px] text-text-muted">
              While un-listed products are being zeroed, a row that matches
              nothing would write real stock down to nil — so it has to be
              resolved first.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="System now" value={String(s.system_total)} />
        <Stat
          label="Written down"
          value={s.writeDown ? `−${s.writeDown}` : "0"}
          tone={s.writeDown ? "danger" : undefined}
        />
        <Stat
          label="Found"
          value={s.surplus ? `+${s.surplus}` : "0"}
          tone={s.surplus ? "success" : undefined}
        />
        <Stat label="Ends at" value={String(s.ends_at)} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Choice
          label="Blank Units cell"
          hint={
            blank === "zero"
              ? "Counted, and there are none — written down to zero."
              : "Not counted — the system's number is left alone."
          }
          value={blank}
          busy={busy}
          onChange={(v) => onDecide({ blank: v })}
          options={[
            { value: "zero", label: "We hold none" },
            { value: "skip", label: "Not counted" },
          ]}
        />
        <Choice
          label="Products not on the sheet"
          hint={
            unlisted === "zero"
              ? "The sheet is everything we hold — the rest goes to zero."
              : "A partial count — everything unmentioned is left alone."
          }
          value={unlisted}
          busy={busy}
          onChange={(v) => onDecide({ unlisted: v })}
          options={[
            { value: "zero", label: "Zero them" },
            { value: "skip", label: "Leave alone" },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-muted">
        <Pill>{s.corrections} corrected</Pill>
        {s.zeroed > 0 && <Pill>{s.zeroed} zeroed</Pill>}
        {s.unchanged > 0 && <Pill>{s.unchanged} already correct</Pill>}
        {result.skipped.length > 0 && (
          <Pill>{result.skipped.length} not counted</Pill>
        )}
        <span className="ml-auto">at {result.location.display_name}</span>
      </div>

      {/* Rows needing a human, before the happy-path list. */}
      {(result.unmatched.length > 0 ||
        result.problems.length > 0 ||
        result.conflicts.length > 0) && (
        <div className="rounded-[11px] border border-danger/25 overflow-hidden">
          <div className="px-4 py-2 bg-danger/[0.06] micro">
            Needs attention
          </div>
          <ul className="divide-y divide-line text-[12.5px]">
            {result.conflicts.map((c) => (
              <li key={c} className="px-4 py-2 text-text-secondary">
                {c}
              </li>
            ))}
            {result.unmatched.map((u) => (
              <li key={`u${u.row}`} className="px-4 py-2 text-text-secondary">
                <span className="font-mono text-text-muted mr-2">
                  row {u.row}
                </span>
                {u.error}
              </li>
            ))}
            {result.problems.map((p) => (
              <li
                key={`p${p.row}-${p.product_name}`}
                className="px-4 py-2 text-text-secondary"
              >
                <span className="text-text-primary mr-2">{p.product_name}</span>
                {p.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.lines.length > 0 && (
        <div className="rounded-[11px] border border-line overflow-hidden">
          <div className="px-4 py-2 micro">
            What changes ({result.lines.length})
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <tbody>
                {result.lines.map((l) => (
                  <tr
                    key={`${l.product_id}-${l.sku ?? ""}`}
                    className="border-t border-line"
                  >
                    <td className="px-4 py-2 font-mono text-text-muted w-[110px]">
                      {l.sku ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-text-primary">
                      {l.product_name}
                      {l.kind === "unlisted" && (
                        <span className="ml-2 micro">not on sheet</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted w-[130px]">
                      {l.system_count}
                      <ArrowRight className="w-3 h-3 inline mx-1.5 -mt-px" />
                      <span className="text-text-primary">
                        {l.physical_count}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums font-mono w-[70px]",
                        l.delta < 0 ? "text-danger" : "text-success",
                      )}
                    >
                      {l.delta > 0 ? "+" : ""}
                      {l.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <FieldLabel>Note / Reference</FieldLabel>
        <TextInput
          value={note}
          onChange={setNote}
          placeholder="e.g. September physical count"
        />
      </div>
    </div>
  );
}

/* ── Step 3 — filed ───────────────────────────────────── */

function FiledView({ result }: { result: CountImportResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-[12px] bg-success/[0.08] border border-success/30">
        <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-px" />
        <div className="text-[13px] text-text-primary">
          <span className="font-semibold">
            {result.adjustment?.adjustment_number}
          </span>{" "}
          submitted for approval — {result.lines.length} line
          {result.lines.length === 1 ? "" : "s"} at{" "}
          {result.location.display_name}.
          <p className="mt-1 text-text-secondary text-[12.5px]">
            Stock has <strong>not</strong> moved yet. Approve and post it on the
            Adjustments tab to make the count the system&apos;s number — the
            location will then hold {result.summary.ends_at} units.
          </p>
        </div>
      </div>
    </div>
  );
}

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
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Pill } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useBaseProducts, type BaseProduct } from "@/lib/catalogue";
import { FieldLabel, TextInput } from "./parts";
import { useStockMutations } from "./hooks";
import type { StockLocation } from "./types";

/**
 * Bulk Goods Reception from an Excel/CSV sheet. The downloadable template has
 * TWO sheets: (1) the recognized base products as a reference list, and (2) the
 * fill-in sheet — Product Code · Product Name · Quantity, with a sample row or
 * two. The operator fills quantities, re-uploads, reviews the matched rows, and
 * on confirm every line lands as a single Goods Reception (stock up at once).
 *
 * No cost anywhere — cost lives in the base-product Cost Vault.
 */

const RECEPTION_SHEET = "Goods Reception";
const REFERENCE_SHEET = "Base Products (reference)";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Read a value from a parsed row by any accepted header spelling. */
function pick(row: Record<string, unknown>, keys: string[]): string {
  const want = new Set(keys.map(norm));
  for (const [k, v] of Object.entries(row)) {
    if (want.has(norm(k))) {
      const s = v == null ? "" : String(v).trim();
      if (s) return s;
    }
  }
  return "";
}

type ParsedRow = {
  rawCode: string;
  rawName: string;
  product_id: string | null;
  matchedName: string;
  matchedCode: string;
  quantity: number | null;
  error: string | null;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse the reception sheet, matching each row to a base product (by code,
 *  then name) and validating the quantity. */
function parseReceptionSheet(file: ArrayBuffer, bases: BaseProduct[]): ParsedRow[] {
  const wb = XLSX.read(file, { type: "array" });
  // Prefer the dedicated reception sheet; fall back to the first non-reference
  // sheet (covers a CSV with a single sheet).
  const name =
    wb.SheetNames.find((n) => /reception/i.test(n)) ??
    wb.SheetNames.find((n) => !/reference|base\s*product/i.test(n)) ??
    wb.SheetNames[0];
  const ws = name ? wb.Sheets[name] : undefined;
  if (!ws) return [];

  const byCode = new Map(bases.map((b) => [norm(b.product_code), b]));
  const byName = new Map(bases.map((b) => [norm(b.name), b]));

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  return json
    .map((raw): ParsedRow => {
      const rawCode = pick(raw, ["productcode", "code", "sku"]);
      const rawName = pick(raw, ["productname", "name", "baseproduct", "product"]);
      const qtyStr = pick(raw, ["quantity", "qty", "units", "count"]);

      const match =
        (rawCode && byCode.get(norm(rawCode))) ||
        (rawName && byName.get(norm(rawName))) ||
        null;

      const qtyNum = Number(qtyStr.replace(/[^0-9.]/g, ""));
      const qtyOk = qtyStr !== "" && Number.isFinite(qtyNum) && qtyNum > 0;

      let error: string | null = null;
      if (!rawCode && !rawName) error = "No product code or name";
      else if (!match) error = "Product not recognized";
      else if (!qtyOk) error = "Quantity must be a positive number";

      return {
        rawCode,
        rawName,
        product_id: match ? match.product_id : null,
        matchedName: match ? match.name : "",
        matchedCode: match ? match.product_code : "",
        quantity: qtyOk ? Math.round(qtyNum) : null,
        error,
      };
    })
    .filter((r) => r.rawCode || r.rawName || r.quantity != null);
}

/** Build + download the 2-sheet template. */
function downloadTemplate(bases: BaseProduct[]) {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — reference list of recognized base products.
  const refHeader = ["Product Code", "Name", "Lace", "Length (in)"];
  const refRows = bases.map((b) => [
    b.product_code,
    b.name,
    b.lace_type ?? "",
    b.hair_length_inches ?? "",
  ]);
  const ref = XLSX.utils.aoa_to_sheet([refHeader, ...refRows]);
  ref["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ref, REFERENCE_SHEET);

  // Sheet 2 — the fill-in sheet: columns + a sample row or two.
  const samples =
    bases.length > 0
      ? bases.slice(0, 2).map((b, i) => [b.product_code, b.name, (i + 1) * 10])
      : [
          ["FLH001N", "Loose Deep Wave", 10],
          ["FLH002N", "Body Wave", 25],
        ];
  const fill = XLSX.utils.aoa_to_sheet([
    ["Product Code", "Product Name", "Quantity"],
    ...samples,
  ]);
  fill["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, fill, RECEPTION_SHEET);

  XLSX.writeFile(wb, "goods-reception-template.xlsx");
}

export function GoodsReceptionImportModal({
  open,
  onClose,
  locations,
  defaultReceiver,
}: {
  open: boolean;
  onClose: () => void;
  locations: StockLocation[];
  defaultReceiver: string;
}) {
  const bases = useBaseProducts({ page_size: 1000 });
  const baseList = useMemo(() => bases.data ?? [], [bases.data]);
  const { createGoodsReceipt } = useStockMutations();

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  // Header fields collected before posting.
  const defaultLocation = useMemo(
    () => locations.find((l) => l.is_default) ?? locations[0],
    [locations],
  );
  const [locationId, setLocationId] = useState("");
  const [receivedAt, setReceivedAt] = useState(todayISO());
  const [receiver, setReceiver] = useState(defaultReceiver);

  useEffect(() => {
    if (open && !locationId && defaultLocation)
      setLocationId(defaultLocation.location_id);
  }, [open, locationId, defaultLocation]);
  useEffect(() => {
    if (open) setReceiver((r) => r || defaultReceiver);
  }, [open, defaultReceiver]);

  const reset = useCallback(() => {
    setFileName("");
    setRows(null);
    setParsing(false);
    setParseError(null);
    setDragOver(false);
    setDoneCount(null);
    createGoodsReceipt.reset();
    if (fileRef.current) fileRef.current.value = "";
  }, [createGoodsReceipt]);

  const close = useCallback(() => {
    if (createGoodsReceipt.isPending) return;
    onClose();
    setTimeout(reset, 250);
  }, [createGoodsReceipt.isPending, onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const ingest = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setParsing(true);
      setParseError(null);
      setDoneCount(null);
      setFileName(file.name);
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseReceptionSheet(buf, baseList);
        if (parsed.length === 0) {
          setParseError(
            "No rows found. Fill the 'Goods Reception' sheet (Product Code / Name + Quantity).",
          );
          setRows(null);
        } else {
          setRows(parsed);
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Could not read that file.");
        setRows(null);
      } finally {
        setParsing(false);
      }
    },
    [baseList],
  );

  const ready = (rows ?? []).filter((r) => !r.error && r.product_id && r.quantity);
  const invalidCount = (rows?.length ?? 0) - ready.length;
  const totalUnits = ready.reduce((s, r) => s + (r.quantity ?? 0), 0);

  const runImport = () => {
    if (ready.length === 0 || !locationId) return;
    createGoodsReceipt.mutate(
      {
        destination_location_id: locationId,
        received_at: receivedAt || undefined,
        received_by_name: receiver || undefined,
        lines: ready.map((r) => ({
          product_id: r.product_id as string,
          quantity: r.quantity as number,
        })),
      },
      { onSuccess: () => setDoneCount(ready.length) },
    );
  };

  const locationOptions = [
    { value: "", label: "Select location" },
    ...locations.map((l) => ({
      value: l.location_id,
      label: `${l.display_name} (${l.location_type.replace(/_/g, " ")})`,
    })),
  ];

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[92] grid place-items-center p-4 bg-black/50 backdrop-blur-[3px] transition-[opacity,visibility] duration-300",
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
          <FileSpreadsheet className="w-5 h-5 text-accent-glow" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-medium leading-tight">
              Import Goods Reception
            </h2>
            <div className="micro mt-0.5">
              {doneCount != null
                ? "Reception complete"
                : rows
                  ? `${rows.length} row${rows.length === 1 ? "" : "s"} read`
                  : "Excel (.xlsx) or CSV — base product + quantity"}
            </div>
          </div>
          <IconButton
            onClick={close}
            aria-label="Close"
            disabled={createGoodsReceipt.isPending}
          >
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {doneCount != null ? (
            <div className="flex items-center gap-3 p-3 rounded-[12px] bg-success/[0.08] border border-success/30">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              <div className="text-[13px] text-text-primary">
                Received <span className="font-semibold">{doneCount}</span> base
                product{doneCount === 1 ? "" : "s"}. Stock is updated.
              </div>
            </div>
          ) : rows ? (
            <PreviewView
              rows={rows}
              readyCount={ready.length}
              invalidCount={invalidCount}
              totalUnits={totalUnits}
              locationId={locationId}
              setLocationId={setLocationId}
              receivedAt={receivedAt}
              setReceivedAt={setReceivedAt}
              receiver={receiver}
              setReceiver={setReceiver}
              locationOptions={locationOptions}
            />
          ) : (
            <ChooseView
              parsing={parsing || bases.isLoading}
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

          {createGoodsReceipt.isError && doneCount == null && (
            <p className="mt-4 text-[12.5px] text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {createGoodsReceipt.error instanceof Error
                ? createGoodsReceipt.error.message
                : "Reception failed. No stock was changed."}
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
            disabled={bases.isLoading}
          >
            Excel template
          </Button>
          <div className="ml-auto flex gap-2">
            {doneCount != null ? (
              <>
                <Button size="sm" variant="ghost" onClick={reset}>
                  Import another
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
                  onClick={reset}
                  disabled={createGoodsReceipt.isPending}
                >
                  Choose another file
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={
                    ready.length === 0 ||
                    !locationId ||
                    createGoodsReceipt.isPending
                  }
                  onClick={runImport}
                  icon={
                    createGoodsReceipt.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : undefined
                  }
                >
                  {createGoodsReceipt.isPending
                    ? "Receiving…"
                    : `Receive ${ready.length} product${ready.length === 1 ? "" : "s"}`}
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

/* ── Choose / drop ──────────────────────────────────────── */
function ChooseView({
  parsing,
  parseError,
  fileName,
  dragOver,
  onPick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
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
        className={cn(
          "w-full rounded-[14px] border border-dashed p-8 grid place-items-center text-center transition-colors",
          dragOver
            ? "border-accent/60 bg-accent/[0.06]"
            : "border-line bg-text-primary/[0.02] hover:border-accent/40",
        )}
      >
        {parsing ? (
          <Loader2 className="w-7 h-7 text-accent-glow animate-spin" />
        ) : (
          <Upload className="w-7 h-7 text-text-faint" />
        )}
        <div className="mt-3 text-[13.5px] font-semibold text-text-primary">
          {parsing
            ? "Reading sheet…"
            : fileName || "Drop your sheet here, or click to choose"}
        </div>
        <div className="mt-1 text-[11.5px] text-text-faint">
          Excel (.xlsx) or CSV — Product Code / Name + Quantity
        </div>
      </button>

      {parseError && (
        <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {parseError}
        </p>
      )}

      <div className="mt-5 rounded-[12px] border hairline p-4 bg-text-primary/[0.02]">
        <div className="micro mb-2">How it works</div>
        <p className="text-[11.5px] text-text-faint leading-relaxed">
          Download the template — it has two sheets:{" "}
          <span className="text-text-muted">Base Products (reference)</span> lists
          every recognized base product, and{" "}
          <span className="text-text-muted">Goods Reception</span> is where you fill
          in quantities. Match is by Product Code first, then Name. No cost column —
          cost lives in the base-product Cost Vault. On confirm, stock for every
          matched row increases at once.
        </p>
      </div>
    </div>
  );
}

/* ── Preview ────────────────────────────────────────────── */
const PREVIEW_CAP = 200;
function PreviewView({
  rows,
  readyCount,
  invalidCount,
  totalUnits,
  locationId,
  setLocationId,
  receivedAt,
  setReceivedAt,
  receiver,
  setReceiver,
  locationOptions,
}: {
  rows: ParsedRow[];
  readyCount: number;
  invalidCount: number;
  totalUnits: number;
  locationId: string;
  setLocationId: (v: string) => void;
  receivedAt: string;
  setReceivedAt: (v: string) => void;
  receiver: string;
  setReceiver: (v: string) => void;
  locationOptions: { value: string; label: string }[];
}) {
  const shown = rows.slice(0, PREVIEW_CAP);
  return (
    <div className="flex flex-col gap-4">
      {/* Reception header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <FieldLabel>Destination location</FieldLabel>
          <Select
            value={locationId}
            onChange={setLocationId}
            options={locationOptions}
          />
        </div>
        <div>
          <FieldLabel>Date received</FieldLabel>
          <TextInput type="date" value={receivedAt} onChange={setReceivedAt} />
        </div>
        <div>
          <FieldLabel>Received by</FieldLabel>
          <TextInput
            value={receiver}
            onChange={setReceiver}
            placeholder="Receiver name"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="success" dot={false}>
          {readyCount} ready
        </Pill>
        {invalidCount > 0 && (
          <Pill tone="danger" dot={false}>
            {invalidCount} to fix
          </Pill>
        )}
        <span className="text-[11.5px] text-text-faint ml-auto tabular-nums">
          {totalUnits} units total
        </span>
      </div>

      <div className="rounded-[12px] border hairline overflow-hidden">
        <div className="max-h-[42vh] overflow-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface/95 backdrop-blur text-text-faint">
                <th className="text-left font-semibold px-3 py-2 w-9">#</th>
                <th className="text-left font-semibold px-3 py-2">Base product</th>
                <th className="text-right font-semibold px-3 py-2">Qty</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={i}
                  className={cn("border-t hairline", r.error && "bg-danger/[0.05]")}
                >
                  <td className="px-3 py-2 text-text-faint tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 text-text-primary max-w-[320px] truncate">
                    {r.matchedName ? (
                      <span>
                        <span className="font-mono text-[11px] text-accent-glow">
                          {r.matchedCode}
                        </span>{" "}
                        · {r.matchedName}
                      </span>
                    ) : (
                      <span className="text-text-faint">
                        {r.rawCode || r.rawName || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {r.quantity ?? "—"}
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
        <p className="text-[11.5px] text-text-faint">
          Showing first {PREVIEW_CAP} of {rows.length} rows — all ready rows will
          be received.
        </p>
      )}
      {invalidCount > 0 && (
        <p className="text-[11.5px] text-text-faint">
          Rows that need fixing are skipped. Correct them in the sheet (check the
          reference tab for exact codes) and re-upload.
        </p>
      )}
    </div>
  );
}

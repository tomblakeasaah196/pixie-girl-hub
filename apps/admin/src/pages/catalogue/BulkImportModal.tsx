import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Boxes,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Pill } from "@/components/ui/primitives";
import {
  useBulkImportProducts,
  useVaultAccess,
  type BulkImportRow,
  type BulkImportResult,
  type ImportStatus,
} from "@/lib/catalogue";

/**
 * Bulk import base products from an Excel/CSV sheet (canon §5 — glass overlay,
 * four states: choose · preview · importing · done/error).
 *
 * The sheet is parsed entirely in the browser (SheetJS) so the operator can
 * REVIEW every row before anything is written. Product codes are generated
 * server-side from Document Numbering (FLH001N / PXG001N) — never typed. The
 * weight column lands on the auto-created default variant, which is the field
 * the shipping engine reads.
 *
 * Expected columns (header matching is case/space/punctuation-insensitive):
 *   Name · Texture · Lace · Length (inches) · Weight (grams)
 */

const TEMPLATE_HEADERS = [
  "Name",
  "Texture",
  "Lace",
  "Length (inches)",
  "Density",
  "Cap Size",
  "Colour",
  "Origin",
  "Short Description",
  "Category",
  "Weight (grams)",
  "Cost (NGN)",
  "Wholesale Price (NGN)",
];

type ParsedRow = {
  name: string;
  texture?: string;
  lace?: string;
  length?: number;
  density?: string;
  cap_size?: string;
  colour?: string;
  origin?: string;
  short_description?: string;
  category?: string;
  weight?: number;
  cost?: number;
  price?: number;
  error: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parse a money cell (Naira) — strips ₦, commas, spaces. */
function parseMoney(s: string): { value?: number; bad: boolean } {
  if (!s) return { value: undefined, bad: false };
  const cleaned = s.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  if (!cleaned || !Number.isFinite(n) || n < 0) return { value: undefined, bad: true };
  return { value: n, bad: false };
}

/** Read a value from a parsed row by any of the accepted header spellings. */
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

/** Parse a numeric cell, distinguishing empty (ok) from non-numeric (bad). */
function parseNum(s: string): { value?: number; bad: boolean } {
  if (!s) return { value: undefined, bad: false };
  const cleaned = s.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  if (!cleaned || !Number.isFinite(n)) return { value: undefined, bad: true };
  return { value: Math.round(n), bad: false };
}

async function parseSheet(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  return json
    .map((raw): ParsedRow => {
      const name = pick(raw, ["name", "productname", "product"]);
      const texture = pick(raw, ["texture", "texturetype"]);
      const lace = pick(raw, ["lace", "lacetype"]);
      const len = parseNum(pick(raw, ["lengthinches", "length", "inches"]));
      const density = pick(raw, ["density"]);
      const cap = pick(raw, ["capsize", "cap"]);
      const colour = pick(raw, ["colour", "color", "primarycolour", "primarycolor"]);
      const origin = pick(raw, ["origin", "hairorigin"]);
      const desc = pick(raw, ["shortdescription", "description", "desc"]);
      const category = pick(raw, ["category", "categoryname"]);
      const wt = parseNum(
        pick(raw, ["weightgrams", "weight", "weightg", "grams"]),
      );
      const cost = parseMoney(pick(raw, ["costngn", "cost", "costnaira"]));
      const price = parseMoney(
        pick(raw, ["wholesalepricengn", "wholesaleprice", "wholesale", "pricengn", "price"]),
      );
      let error: string | null = null;
      if (!name) error = "Missing name";
      else if (len.bad) error = "Length must be a number";
      else if (len.value != null && (len.value < 0 || len.value > 60))
        error = "Length must be 0–60 inches";
      else if (wt.bad) error = "Weight must be a number";
      else if (cost.bad) error = "Cost must be a number";
      else if (price.bad) error = "Price must be a number";
      return {
        name,
        texture: texture || undefined,
        lace: lace || undefined,
        length: len.value,
        density: density || undefined,
        cap_size: cap || undefined,
        colour: colour || undefined,
        origin: origin || undefined,
        short_description: desc || undefined,
        category: category || undefined,
        weight: wt.value,
        cost: cost.value,
        price: price.value,
        error,
      };
    })
    .filter((r) => r.name || r.texture || r.lace || r.length != null);
}

function downloadTemplate() {
  // A blank, header-only CSV plus two example rows so the sheet stays clean
  // (no stray columns) — fill in and re-upload. Product code is intentionally
  // absent: the system generates it.
  // Cost is only applied for Cost-Vault holders; non-owners can leave Cost (and
  // Price) blank to import "raw". All money is Naira.
  const csv = [
    TEMPLATE_HEADERS.join(","),
    "Loose Deep Wave,Natural,HD Lace,18,150%,Medium,1B Natural Black,Human,Soft loose deep wave,Wigs,220,45000,120000",
    "Body Wave,Natural,Transparent Lace,20,180%,Medium,1B Natural Black,Human,,Wigs,250,,",
  ].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "product-import-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BulkImportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const imp = useBulkImportProducts();
  const vault = useVaultAccess();
  const canCost = !!vault.data?.can_see;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const reset = useCallback(() => {
    setFileName("");
    setRows(null);
    setParsing(false);
    setParseError(null);
    setDragOver(false);
    setResult(null);
    imp.reset();
    if (fileRef.current) fileRef.current.value = "";
  }, [imp]);

  const close = useCallback(() => {
    if (imp.isPending) return; // don't drop an in-flight import
    onClose();
    // Defer reset so the closing transition doesn't flash the empty state.
    setTimeout(reset, 250);
  }, [imp.isPending, onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const ingest = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const parsed = await parseSheet(file);
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
  }, []);

  const valid = (rows ?? []).filter((r) => !r.error);
  const invalidCount = (rows?.length ?? 0) - valid.length;

  const runImport = () => {
    if (valid.length === 0) return;
    const payload: BulkImportRow[] = valid.map((r) => ({
      name: r.name,
      texture_type: r.texture,
      lace_type: r.lace,
      hair_length_inches: r.length,
      density: r.density,
      cap_size: r.cap_size,
      primary_colour: r.colour,
      hair_origin: r.origin,
      short_description: r.short_description,
      category: r.category,
      weight_g: r.weight,
      cost_ngn: r.cost,
      wholesale_price_ngn: r.price,
    }));
    imp.mutate(payload, { onSuccess: (res) => setResult(res) });
  };

  return (
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
              Import products from Excel
            </h2>
            <div className="micro mt-0.5">
              {result
                ? "Import complete"
                : rows
                  ? `${rows.length} row${rows.length === 1 ? "" : "s"} read`
                  : "Excel (.xlsx) or CSV"}
            </div>
          </div>
          <IconButton onClick={close} aria-label="Close" disabled={imp.isPending}>
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {result ? (
            <ResultView result={result} />
          ) : rows ? (
            <PreviewView
              rows={rows}
              invalidCount={invalidCount}
              validCount={valid.length}
              canCost={canCost}
            />
          ) : (
            <ChooseView
              parsing={parsing}
              parseError={parseError}
              fileName={fileName}
              dragOver={dragOver}
              canCost={canCost}
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
                : "Import failed. No products were created."}
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
            onClick={downloadTemplate}
          >
            CSV template
          </Button>
          <div className="ml-auto flex gap-2">
            {result ? (
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
                    : `Import ${valid.length} product${valid.length === 1 ? "" : "s"}`}
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
    </div>
  );
}

/* ── Choose / drop ──────────────────────────────────────── */
function ChooseView({
  parsing,
  parseError,
  fileName,
  dragOver,
  canCost,
  onPick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  parsing: boolean;
  parseError: string | null;
  fileName: string;
  dragOver: boolean;
  canCost: boolean;
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
          Excel (.xlsx) or CSV · up to 1000 rows
        </div>
      </button>

      {parseError && (
        <p className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {parseError}
        </p>
      )}

      <div className="mt-5 rounded-[12px] border hairline p-4 bg-text-primary/[0.02]">
        <div className="micro mb-2">Expected columns</div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_HEADERS.map((h) => (
            <span
              key={h}
              className="text-[11px] font-semibold px-2 py-1 rounded-[8px] bg-text-primary/[0.06] text-text-muted"
            >
              {h}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-text-faint leading-relaxed">
          Product codes are generated automatically from Document Numbering
          (e.g. <span className="font-mono text-text-muted">FLH001N</span>) — you
          never type them. Money is always in Naira. Headers are matched loosely,
          so minor spelling differences are fine. A row whose{" "}
          <span className="text-text-muted">Name</span> already exists is{" "}
          <span className="text-text-muted">updated</span>, not duplicated — so
          re-upload with prices filled in to price everything at once.
        </p>
        <p
          className={cn(
            "mt-2 text-[11.5px] leading-relaxed",
            canCost ? "text-text-faint" : "text-warn",
          )}
        >
          {canCost
            ? "You hold Cost-Vault access, so the Cost column will be saved (encrypted)."
            : "You don't have Cost-Vault access — the Cost column is ignored. Wholesale Price still imports."}
        </p>
      </div>
    </div>
  );
}

/* ── Preview ────────────────────────────────────────────── */
const PREVIEW_CAP = 200;
function PreviewView({
  rows,
  invalidCount,
  validCount,
  canCost,
}: {
  rows: ParsedRow[];
  invalidCount: number;
  validCount: number;
  canCost: boolean;
}) {
  const shown = rows.slice(0, PREVIEW_CAP);
  const ngn = (n?: number) => (n != null ? `₦${n.toLocaleString()}` : "—");
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
          Codes are assigned on import
        </span>
      </div>

      <div className="rounded-[12px] border hairline overflow-hidden">
        <div className="max-h-[46vh] overflow-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface/95 backdrop-blur text-text-faint">
                <th className="text-left font-semibold px-3 py-2 w-9">#</th>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-right font-semibold px-3 py-2">Length</th>
                <th className="text-right font-semibold px-3 py-2">Cost</th>
                <th className="text-right font-semibold px-3 py-2">Price</th>
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
                  <td className="px-3 py-2 text-text-primary max-w-[260px] truncate">
                    {r.name || <span className="text-text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {r.length != null ? `${r.length}"` : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      r.cost != null && !canCost
                        ? "text-text-faint line-through"
                        : "text-text-muted",
                    )}
                  >
                    {ngn(r.cost)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {ngn(r.price)}
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

/* ── Result ─────────────────────────────────────────────── */
const STATUS_META: Record<ImportStatus, { label: string; tone: "success" | "info" | "neutral" }> = {
  created: { label: "New", tone: "success" },
  updated: { label: "Updated", tone: "info" },
  up_to_date: { label: "Up to date", tone: "neutral" },
};

function ResultView({ result }: { result: BulkImportResult }) {
  const shown = result.created.slice(0, PREVIEW_CAP);
  const c = result.counts || {};
  const parts = [
    c.created ? `${c.created} new` : null,
    c.updated ? `${c.updated} updated` : null,
    c.up_to_date ? `${c.up_to_date} already up to date` : null,
  ].filter(Boolean);
  return (
    <div>
      <div className="flex items-center gap-3 mb-3 p-3 rounded-[12px] bg-success/[0.08] border border-success/30">
        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
        <div className="text-[13px] text-text-primary">
          <span className="font-semibold">{result.count}</span> row
          {result.count === 1 ? "" : "s"} processed
          {parts.length ? ` — ${parts.join(" · ")}.` : "."}{" "}
          Existing products were updated in place, not duplicated.
        </div>
      </div>

      {result.cost_ignored && (
        <p className="mb-3 text-[11.5px] text-warn flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          The Cost column was ignored (no Cost-Vault access). Wholesale prices
          were still saved.
        </p>
      )}

      <div className="rounded-[12px] border hairline overflow-hidden">
        <div className="max-h-[44vh] overflow-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface/95 backdrop-blur text-text-faint">
                <th className="text-left font-semibold px-3 py-2">Code</th>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-left font-semibold px-3 py-2">Result</th>
                <th className="text-center font-semibold px-3 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.updated;
                return (
                  <tr key={`${r.product_id}-${r.row}`} className="border-t hairline">
                    <td className="px-3 py-2 font-mono text-[11px] text-accent-glow">
                      {r.product_code}
                    </td>
                    <td className="px-3 py-2 text-text-primary max-w-[300px] truncate">
                      {r.name}
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={meta.tone} dot={false}>
                        {meta.label}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.cost_applied ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success inline" />
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {result.created.length > PREVIEW_CAP && (
        <p className="mt-2 text-[11.5px] text-text-faint flex items-center gap-1.5">
          <Boxes className="w-3.5 h-3.5" />
          Showing first {PREVIEW_CAP} of {result.count} — all are saved.
        </p>
      )}
    </div>
  );
}

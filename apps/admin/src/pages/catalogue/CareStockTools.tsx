import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button, Pill } from "@/components/ui/primitives";
import { useStockLocations } from "@/pages/stock/hooks";
import { useVaultAccess } from "@/lib/catalogue";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore } from "@/stores/business";
import { toast } from "@/stores/toast";
import { careStockApi, type CareCountResult } from "@/lib/care-accessories";
import { assertNoLotColumns, careReceiptLines, type CareReceiptLine } from "@/lib/care-sheets";

const inputCls = "w-full h-10 rounded-[10px] border border-line bg-text-primary/[0.04] px-3 text-[12px] text-text-primary";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
async function readSheet(file: File): Promise<Record<string, unknown>[]> {
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no sheet");
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}
function saveSheet(name: string, headers: string[], rows: (string | number)[][]) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = headers.map((_, i) => ({ wch: i < 2 ? 34 : 22 }));
  XLSX.utils.book_append_sheet(book, sheet, "Care SKUs");
  XLSX.writeFile(book, name);
}
function err(e: unknown) {
  toast.error("Care stock action failed", { description: e instanceof Error ? e.message : "Try again", report: { area: "Care & Accessories · stock", action: "Count or receive", message: String(e) } });
}

/** These tools NEVER use the wig name/colour/size count matcher: identity is
 * case-sensitive SKU, location is mandatory and unlisted defaults to skip. */
export function CareStockTools({ kind, open, onClose }: { kind: "count" | "receipt"; open: boolean; onClose: () => void }) {
  const brand = useBusinessStore((s) => s.activeKey);
  const { can } = useAuthStore();
  const qc = useQueryClient();
  const vault = useVaultAccess();
  const locations = useStockLocations();
  const [location, setLocation] = useState("");
  const [blank, setBlank] = useState<"skip" | "zero">("skip");
  const [unlisted, setUnlisted] = useState<"skip" | "zero">("skip");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CareCountResult | null>(null);
  const [receiptLines, setReceiptLines] = useState<CareReceiptLine[]>([]);
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const skus = useQuery({
    queryKey: ["care", brand, "stock-skus", location],
    queryFn: () => careStockApi.skus(location),
    enabled: open && brand === "pixiegirl" && !!location && can("stock", "view"),
  });
  const count = useMutation({ mutationFn: careStockApi.count });
  const receipt = useMutation({ mutationFn: careStockApi.receipt });
  useEffect(() => { setPreview(null); setReceiptLines([]); setRows([]); setLocalErrors([]); setFileName(""); }, [location, kind]);
  useEffect(() => { setPreview(null); }, [blank, unlisted, rows]);

  if (!open) return null;
  const canUse = brand === "pixiegirl" && can("stock", "create") &&
    (kind !== "receipt" || vault.data?.can_see === true);
  const source = skus.data?.rows ?? [];
  const countInput = (commit: boolean) => ({ location_id: location, rows, blank, unlisted, reason: reason.trim() || `Care SKU count · ${fileName}`, commit });
  const download = () => {
    if (!location || !skus.data) return;
    const date = new Date().toISOString().slice(0, 10);
    if (kind === "count") saveSheet(`PXG-care-count-${date}.xlsx`,
      ["SKU", "Product", "Option", "System on hand", "Units"],
      source.map((s) => [s.sku, s.product_name, s.variant_name, Number(s.on_hand), ""]));
    else saveSheet(`PXG-care-receipt-${date}.xlsx`,
      ["SKU", "Product", "Option", "Units", "Operational unit cost NGN"],
      source.filter((s) => s.is_active).map((s) => [s.sku, s.product_name, s.variant_name, "", ""]));
  };
  const upload = async (file: File) => {
    // A failed replacement must never leave an old preview or receipt enabled.
    setFileName(""); setRows([]); setPreview(null); setReceiptLines([]); setLocalErrors([]);
    try {
      const parsed = await readSheet(file);
      if (!parsed.length) throw new Error("The sheet has no data rows");
      assertNoLotColumns(parsed);
      if (!Object.keys(parsed[0]).some((h) => norm(h) === "sku")) throw new Error("A SKU column is required");
      if (kind === "count" && !Object.keys(parsed[0]).some((h) => ["units", "unitsno", "physicalcount", "quantity", "qty", "count"].includes(norm(h)))) throw new Error("An Units column is required");
      setFileName(file.name); setRows(parsed); setPreview(null); setReceiptLines([]); setLocalErrors([]);
      if (kind === "receipt") {
        const checked = careReceiptLines(parsed, source);
        setLocalErrors(checked.errors);
        setReceiptLines(checked.lines);
      }
    } catch (e) { err(e); }
  };
  const previewCount = async () => {
    if (!location || !rows.length) return;
    try { setPreview(await count.mutateAsync(countInput(false))); } catch (e) { err(e); }
  };
  const commitCount = async () => {
    try {
      const result = await count.mutateAsync(countInput(true));
      toast.success(`${result.adjustment?.adjustment_number} submitted; stock moves after approval/posting`);
      qc.invalidateQueries({ queryKey: [brand, "stock", "adjustments"] });
      onClose();
    } catch (e) { setPreview(null); err(e); }
  };
  const commitReceipt = async () => {
    try {
      await receipt.mutateAsync({ destination_location_id: location, notes: reason.trim() || `Care SKU intake · ${fileName}`,
        lines: receiptLines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_cost_ngn: l.unit_cost_ngn })) });
      toast.success(`${receiptLines.length} Care SKU(s) received; movements and costing posted`);
      qc.invalidateQueries({ queryKey: ["care", brand] });
      qc.invalidateQueries({ queryKey: [brand, "stock"] });
      onClose();
    } catch (e) { err(e); }
  };
  const total = preview?.summary;
  return <Modal open={open} onClose={onClose} size="lg" title={kind === "count" ? "Care SKU stock count" : "Receive Care SKUs"}>
    <div className="space-y-4 text-[12px]">
      {!canUse ? <p className="text-danger">PXG Stock Create {kind === "receipt" ? "and Cost Vault" : ""} access required.</p> : <>
        <p className="text-text-muted">{kind === "count" ? "Counts REPLACE on-hand units at one location. Exact SKU matching only; missing SKUs are skipped by default. Changes are submitted for approval, never applied on upload." : "Intake ADDS stock at one location. Every exact SKU requires positive units and an authorised operational cost. True confidential supplier cost remains in the separate Cost Vault."}</p>
        <label className="block space-y-1"><span className="micro">Stock location · required</span>
          <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Select a location…</option>
            {(locations.data ?? []).filter((l) => l.is_active).map((l) => <option key={l.location_id} value={l.location_id}>{l.display_name}</option>)}
          </select>
        </label>
        {skus.isError && <p className="text-danger">Couldn't load the Care SKU register. Check your location and permissions.</p>}
        {location && skus.data && <>
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" onClick={download}>Download {kind === "count" ? "count" : "intake"} template · {source.length} SKUs</Button>
            <label className="cursor-pointer text-accent-glow font-semibold">
              {fileName || "Choose Excel/CSV sheet"}
              <input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
            </label>
          </div>
          {kind === "count" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1"><span className="micro">Blank Units cell</span><select className={inputCls} value={blank} onChange={(e) => setBlank(e.target.value as "skip" | "zero")}>
              <option value="skip">Skip · default</option><option value="zero">Count as zero</option>
            </select></label>
            <label className="space-y-1"><span className="micro">SKUs not in sheet</span><select className={inputCls} value={unlisted} onChange={(e) => setUnlisted(e.target.value as "skip" | "zero")}>
              <option value="skip">Keep current count · default</option><option value="zero">Count all omitted Care SKUs as zero</option>
            </select></label>
          </div>}
          <label className="block space-y-1"><span className="micro">Reason / receipt notes</span><input className={inputCls} value={reason} maxLength={180} onChange={(e) => setReason(e.target.value)} /></label>
          {kind === "count" && <>
            {rows.length > 0 && <Button size="sm" disabled={count.isPending} onClick={previewCount}>Preview reconciliation · {rows.length} sheet rows</Button>}
            {preview && <div className="rounded-[12px] border border-line p-4 space-y-3">
              <div className="font-semibold">{total?.corrections} corrected · {total?.zeroed} omitted zeroed · {total?.unchanged} unchanged · {total?.ends_at} units after posting</div>
              {preview.blockers.map((s, i) => <p key={i} className="text-danger">✖ {s}</p>)}
              <div className="max-h-52 overflow-y-auto">
                {preview.lines.map((l) => <div key={l.variant_id} className="py-1 border-b border-line/60">{l.sku} · {l.product_name}: {l.system_count} → {l.physical_count} <Pill tone={l.delta > 0 ? "success" : "warn"}>{l.delta >= 0 ? "+" : ""}{l.delta}</Pill></div>)}
              </div>
              {!preview.blockers.length && !!preview.lines.length && <Button variant="primary" size="sm" disabled={count.isPending} onClick={commitCount}>Submit count for approval · no stock move yet</Button>}
              {preview.lines.length === 0 && !preview.blockers.length && <p className="text-text-muted">No correction needed.</p>}
            </div>}
          </>}
          {kind === "receipt" && <>
            {localErrors.map((msg, i) => <p key={i} className="text-danger">✖ {msg}</p>)}
            <div className="max-h-56 overflow-y-auto">{receiptLines.map((l) => <div key={l.variant_id} className="py-1 border-b border-line/60">{l.product_name} · {l.variant_name} ({l.sku}): +{l.quantity} units</div>)}</div>
            {receiptLines.length > 0 && !localErrors.length && <Button variant="primary" size="sm" disabled={receipt.isPending} onClick={commitReceipt}>Receive {receiptLines.length} exact SKU(s)</Button>}
          </>}
        </>}
      </>}
      <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
    </div>
  </Modal>;
}

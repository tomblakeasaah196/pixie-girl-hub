import { useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import { useCareCategories, type CareProduct, type CareVariant, type CareCreateInput } from "@/lib/care-accessories";
import { catalogueDrafts } from "@/lib/care-sheets";
import { useAuthStore } from "@/stores/auth";
import { toast } from "@/stores/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";

const ROOT = "/catalogue/care-accessories";
const HEADERS = ["Name", "Product Code", "Category", "Tax Treatment", "VAT Fraction", "SKU", "Option Label", "Barcode", "Storefront NGN", "Staff POS NGN", "Storefront USD", "Staff POS USD", "Reorder Point", "Short Description", "Long Description", "Ingredients", "Directions", "Warnings", "Search Keywords"];
const str = (v: string | number | null | undefined) => v == null ? "" : String(v);
/** Safe spreadsheet authoring, not a wig/base upsert. Imports create NEW PXG
 * draft items only; costs/stock are never columns on this sheet. */
export function CareCatalogueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const brand = useBusinessStore((s) => s.activeKey);
  const { can } = useAuthStore();
  const qc = useQueryClient();
  const categories = useCareCategories();
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<CareCreateInput[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!open) return null;
  const download = (filename: string, rows: (string | number)[][]) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
    ws["!cols"] = HEADERS.map((_, i) => ({ wch: i === 0 || i === 2 ? 30 : 22 }));
    XLSX.utils.book_append_sheet(wb, ws, "Care Catalogue"); XLSX.writeFile(wb, filename);
  };
  const template = () => download("PXG-care-catalogue-create-template.xlsx", []);
  const exportAll = async () => {
    setBusy(true);
    try {
      const all: CareProduct[] = [];
      for (let page = 1; ; page++) {
        const result = await api.get<{ data: CareProduct[]; meta: { has_more: boolean } }>(`${ROOT}?page_size=100&page=${page}`);
        all.push(...result.data);
        if (!result.meta.has_more) break;
      }
      // Snapshot includes inactive options, but excludes any confidential costs.
      const details: CareProduct[] = [];
      for (let i = 0; i < all.length; i += 20)
        details.push(...await Promise.all(all.slice(i, i + 20).map((p) => api.get<CareProduct>(`${ROOT}/${p.product_id}`))));
      download(`PXG-care-catalogue-${new Date().toISOString().slice(0, 10)}.xlsx`,
        details.flatMap((p) => (p.variants ?? []).map((v: CareVariant) => [
          p.name, p.product_code, (categories.data ?? []).find((c) => c.category_id === p.category_id)?.name ?? "",
          p.taxable ? "taxable" : "exempt", str(p.vat_rate), v.sku, v.variant_name,
          v.barcode ?? "", str(v.price_storefront_ngn), str(v.price_pos_ngn), str(v.price_storefront_usd),
          str(v.price_pos_usd), v.reorder_point ?? 0, p.short_description ?? "", p.long_description ?? "",
          p.ingredients ?? "", p.directions ?? "", p.warnings ?? "", (p.search_keywords ?? []).join(", "),
        ])));
      toast.success(`${all.length} Care item(s) exported (no costs)`);
    } catch (e) { toast.error("Export failed", { description: e instanceof Error ? e.message : "Try again" }); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setFileName(file.name); setProblems([]); setItems([]); setConfirm(false);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("No sheet found");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
      const parsed = catalogueDrafts(rows, categories.data ?? []);
      setProblems(parsed.errors);
      setItems(parsed.items);
    } catch (e) { setProblems([e instanceof Error ? e.message : "Couldn't read the file"]); }
  };
  const commit = async () => {
    if (problems.length || !items.length || !confirm) return;
    setBusy(true);
    try {
      const result = await api.post<{ count: number }>(`${ROOT}/import`, { products: items });
      toast.success(`${result.count} new Care draft(s) imported; no stock moved`);
      qc.invalidateQueries({ queryKey: ["care", brand] });
      setFileName(""); setItems([]); setConfirm(false); onClose();
    } catch (e) { toast.error("No items imported", { description: e instanceof Error ? e.message : "Try again", report: { area: "Catalogue · Care & Accessories", action: "Spreadsheet import", message: String(e) } }); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} size="lg" title="Care & Accessories · import / export">
    <div className="space-y-4 text-[12px]">
      <p className="text-text-muted">Create-only import: one row per SKU, repeat product code to group labelled options. All items start draft at zero stock; costs/receipts are handled separately. An export is a snapshot, NOT an upsert file. No medical claims are generated.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={template}>Download blank template</Button><Button size="sm" disabled={busy} onClick={exportAll}>Export current catalogue · excludes costs</Button></div>
      {can("catalogue", "create") && <label className="block text-accent-glow font-semibold cursor-pointer">
        {fileName || "Choose Excel/CSV file to preview"}<input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </label>}
      {problems.map((p, i) => <p key={i} className="text-danger">✖ {p}</p>)}
      {items.length > 0 && <div className="max-h-48 overflow-y-auto border border-line rounded-[12px] p-3">
        {items.map((p, i) => <div key={i} className="py-1 border-b border-line/60">{p.name} · {p.product_code || "new code"} · {p.variants.length} SKU(s) · draft</div>)}
      </div>}
      {!problems.length && items.length > 0 && <><label className="flex gap-2 items-center"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I reviewed new item codes, exact SKUs, copy, tax and prices. This creates drafts only.</label>
        <Button variant="primary" size="sm" disabled={!confirm || busy} onClick={commit}>{busy ? "Importing…" : `Create ${items.length} drafts`}</Button></>}
      <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></div>
    </div>
  </Modal>;
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Package, Upload, Download, ClipboardCheck, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useCareCategories, useCareProducts, useCareTrash, useCareActions, type CareProduct } from "@/lib/care-accessories";
import { toast } from "@/stores/toast";
import { Modal } from "@/components/ui/Modal";
import { SearchBox, CardGrid, CardGridSkeleton, CardShell, CardImage, Tabs } from "./parts";
import { CareStockTools } from "./CareStockTools";
import { CareCatalogueSheet } from "./CareCatalogueSheet";

const statusTabs = [
  { key: "all", label: "All" }, { key: "draft", label: "Drafts" },
  { key: "live", label: "Published" }, { key: "archived", label: "Archived" },
];
const statusTone = { draft: "warn", live: "success", archived: "neutral" } as const;

/** Staff-only in PR1; no customer catalogue, links or checkout yet. */
export function CareTab() {
  const nav = useNavigate();
  const { can } = useAuthStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState(false);
  const [count, setCount] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const trash = useCareTrash(trashOpen);
  const actions = useCareActions();
  const products = useCareProducts({ q: q || undefined, category_id: category || undefined, status: status === "all" ? undefined : status, page, page_size: 24 });
  const categories = useCareCategories();
  const reset = () => setPage(1);
  const rows = products.data?.data ?? [];
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-text-muted">
        PXG Care & Accessories · author, price and receive stock here. Publication is an explicit staff review; customer sales stay off in this PR.
      </p>
      <div className="flex gap-2 flex-wrap items-center">
        <SearchBox value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Search name, product code or exact SKU…" />
        <select className="h-9 rounded-[10px] border border-line bg-surface px-3 text-[12px] text-text-primary" aria-label="Care category"
          value={category} onChange={(e) => { setCategory(e.target.value); reset(); }}>
          <option value="">All care categories</option>
          {(categories.data ?? []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
        </select>
        <div className="ml-auto flex gap-2 flex-wrap">
          {can("catalogue", "edit") && <Button size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setTrashOpen(true)}>Trash</Button>}
          {can("stock", "create") && <Button size="sm" icon={<ClipboardCheck className="w-3.5 h-3.5" />} onClick={() => setCount(true)}>Count SKUs</Button>}
          {can("stock", "create") && <Button size="sm" icon={<Download className="w-3.5 h-3.5" />} onClick={() => setReceipt(true)}>Receive SKUs</Button>}
          {can("catalogue", "view") && <Button size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => setSheet(true)}>Import / export</Button>}
          {can("catalogue", "create") && <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => nav("/catalogue/care/new")}>New care item</Button>}
        </div>
      </div>
      <Tabs tabs={statusTabs} active={status} onChange={(v) => { setStatus(v); reset(); }} />
      {products.isLoading ? <CardGridSkeleton /> : products.isError ? <ErrorState onRetry={() => products.refetch()} /> : rows.length === 0 ? (
        <Card><EmptyState icon={<Package className="w-8 h-8" />} title="No Care & Accessories items" message="Add a simple SKU or labelled options. Items start as drafts; stock is tracked per SKU." /></Card>
      ) : (
        <CardGrid>{rows.map((p) => <CareCard key={p.product_id} p={p} onOpen={() => nav(`/catalogue/care/${p.product_id}`)} />)}</CardGrid>
      )}
      {(page > 1 || products.data?.meta.has_more) && <div className="flex items-center justify-center gap-3 text-[12px] text-text-muted">
        <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
        Page {page} · {products.data?.meta.total ?? 0} items
        <Button size="sm" disabled={!products.data?.meta.has_more} onClick={() => setPage(page + 1)}>Next</Button>
      </div>}
      <CareCatalogueSheet open={sheet} onClose={() => setSheet(false)} />
      <CareStockTools kind="count" open={count} onClose={() => setCount(false)} />
      <CareStockTools kind="receipt" open={receipt} onClose={() => setReceipt(false)} />
      {trashOpen && <Modal open={trashOpen} onClose={() => setTrashOpen(false)} title="Care & Accessories trash" size="md">
        <p className="text-[12px] text-text-muted mb-3">Restore returns an item to draft. Previously used SKUs and stock history remain attached.</p>
        {trash.isLoading ? <p>Loading…</p> : trash.isError ? <ErrorState onRetry={() => trash.refetch()} /> :
          (trash.data?.data ?? []).length === 0 ? <p className="text-[12px] text-text-muted">Trash is empty.</p> :
          (trash.data?.data ?? []).map((p) => <div key={p.product_id} className="flex items-center justify-between gap-2 py-2 border-b border-line text-[12px]">
            <span>{p.name} · <span className="font-mono">{p.product_code}</span></span>
            <Button size="sm" disabled={actions.restore.isPending} onClick={async () => {
              try { const restored = await actions.restore.mutateAsync(p.product_id); toast.success("Item restored as draft"); setTrashOpen(false); nav(`/catalogue/care/${restored.product_id}`); }
              catch (e) { toast.error("Restore failed", { description: e instanceof Error ? e.message : "Try again" }); }
            }}>Restore</Button>
          </div>)}
        {trash.data?.meta.has_more && <p className="text-[11px] text-text-muted mt-2">Showing first 100 trashed items. Restore older items by ID through the API.</p>}
        <div className="flex justify-end mt-4"><Button size="sm" onClick={() => setTrashOpen(false)}>Close</Button></div>
      </Modal>}
    </div>
  );
}

function CareCard({ p, onOpen }: { p: CareProduct; onOpen: () => void }) {
  return <CardShell onOpen={onOpen} className="text-left glass rounded-[var(--radius)] shadow-glass p-4 transition-all hover:border-accent/40 focus:outline-none focus:border-accent/50">
    <CardImage url={p.primary_image_url} name={p.name} />
    <div className="flex items-start justify-between gap-2 mb-2">
      <span className="font-mono text-[10.5px] text-accent-glow">{p.product_code}</span>
      <Pill tone={statusTone[p.retail_status]} dot={false}>{p.retail_status === "live" ? "Published" : p.retail_status}</Pill>
    </div>
    <div className="font-semibold text-[13px] text-text-primary line-clamp-2">{p.name}</div>
    <div className="text-[11px] text-text-muted mt-2">{p.category_name || "Uncategorised"} · {Number(p.stock_available || 0)} available</div>
  </CardShell>;
}

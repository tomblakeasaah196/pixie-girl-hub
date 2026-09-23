import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, ImagePlus } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { toast } from "@/stores/toast";
import { Button, Card, Pill, MoneyText } from "@/components/ui/primitives";
import { ErrorState, DeniedState, ConfirmDialog } from "@/components/ui/controls";
import { Field, FormSection, FormGrid } from "@/components/ui/Form";
import { CostVaultSection } from "./CostVaultSection";
import { Modal } from "@/components/ui/Modal";
import {
  useCareActions, useCareAvailability, useCareCategories, useCareProduct,
  type CareProduct, type CareVariant, type CareVariantInput, type CareCreateInput,
} from "@/lib/care-accessories";

const inputCls = "w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 disabled:opacity-60";
const textCls = `${inputCls} h-auto min-h-[90px] py-2`;
const error = (e: unknown) => toast.error("Couldn't save Care & Accessories", { description: e instanceof Error ? e.message : "Try again", report: { area: "Catalogue · Care & Accessories", action: "Save", message: String(e) } });
const value = (v: number | string | null | undefined) => v == null ? "" : String(v);
const num = (v: string) => v.trim() === "" ? null : Number(v);

interface Details {
  name: string; product_code: string; category_id: string;
  short_description: string; long_description: string; ingredients: string;
  directions: string; warnings: string; search_keywords: string;
  tax: "" | "exempt" | "taxable"; vat_rate: string;
}
const empty: Details = { name: "", product_code: "", category_id: "", short_description: "", long_description: "", ingredients: "", directions: "", warnings: "", search_keywords: "", tax: "", vat_rate: "" };
function fromProduct(p: CareProduct): Details {
  return { name: p.name, product_code: p.product_code, category_id: p.category_id ?? "", short_description: p.short_description ?? "", long_description: p.long_description ?? "", ingredients: p.ingredients ?? "", directions: p.directions ?? "", warnings: p.warnings ?? "", search_keywords: (p.search_keywords ?? []).join(", "), tax: p.taxable ? "taxable" : "exempt", vat_rate: value(p.vat_rate) };
}
function fields(d: Details): Omit<CareCreateInput, "variants"> {
  if (!d.name.trim()) throw new Error("Enter a product name");
  if (!d.category_id) throw new Error("Select a Care & Accessories category");
  if (!d.tax) throw new Error("Choose exempt or taxable; no wig VAT is assumed");
  if (d.tax === "taxable" && (d.vat_rate.trim() === "" || !Number.isFinite(Number(d.vat_rate)) || Number(d.vat_rate) < 0 || Number(d.vat_rate) > 1))
    throw new Error("Enter the approved VAT rate as a fraction (e.g. 0.075)");
  return {
    name: d.name.trim(), ...(d.product_code.trim() ? { product_code: d.product_code.trim() } : {}),
    category_id: d.category_id, short_description: d.short_description.trim() || null,
    long_description: d.long_description.trim() || null, ingredients: d.ingredients.trim() || null,
    directions: d.directions.trim() || null, warnings: d.warnings.trim() || null,
    search_keywords: d.search_keywords.split(",").map((s) => s.trim()).filter(Boolean),
    taxable: d.tax === "taxable", vat_rate: d.tax === "taxable" ? Number(d.vat_rate) : null,
  };
}

export function CareProductPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuthStore();
  const gate = useCareAvailability();
  const isNew = !id || id === "new";
  const product = useCareProduct(gate.data?.enabled && !isNew ? id! : null);
  useBreadcrumbs([{ label: "Catalogue", href: "/catalogue?tab=care" }, { label: product.data?.name ?? (isNew ? "New care item" : "Care item") }]);
  if (gate.isLoading) return <Card className="p-6">Checking availability…</Card>;
  if (!gate.data?.enabled || !can("catalogue", "view")) return <DeniedState message="Care & Accessories is available to PXG staff only when enabled." />;
  if (isNew) return can("catalogue", "create") ? <CareCreate /> : <DeniedState message="You need Catalogue Create access." />;
  if (product.isLoading) return <Card className="p-6">Loading care item…</Card>;
  if (product.isError || !product.data) return <ErrorState onRetry={() => product.refetch()} />;
  return <CareEditor key={id} p={product.data} onBack={() => nav("/catalogue?tab=care")} />;
}

function DetailsForm({ d, set, isNew }: { d: Details; set: (next: Details) => void; isNew: boolean }) {
  const cats = useCareCategories();
  const change = (key: keyof Details, val: string) => set({ ...d, [key]: val });
  return <FormSection title="Care item · copy & classification">
    <FormGrid>
      <Field label="Name"><input className={inputCls} value={d.name} maxLength={200} onChange={(e) => change("name", e.target.value)} /></Field>
      <Field label="Product code" hint={isNew ? "optional; generated if blank" : "fixed after creation"}>
        <input className={inputCls} value={d.product_code} disabled={!isNew} onChange={(e) => change("product_code", e.target.value)} />
      </Field>
      <Field label="Care category"><select className={inputCls} value={d.category_id} onChange={(e) => change("category_id", e.target.value)}>
        <option value="">Select category…</option>
        {(cats.data ?? []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
      </select></Field>
      <Field label="Tax treatment" hint="select explicitly"><select className={inputCls} value={d.tax} onChange={(e) => change("tax", e.target.value)}>
        <option value="">Select…</option><option value="exempt">Exempt</option><option value="taxable">Taxable</option>
      </select></Field>
      {d.tax === "taxable" && <Field label="Approved VAT rate" hint="fraction, e.g. 0.075"><input className={inputCls} type="number" min="0" max="1" step="0.001" value={d.vat_rate} onChange={(e) => change("vat_rate", e.target.value)} /></Field>}
      <Field label="Search keywords" hint="comma-separated"><input className={inputCls} value={d.search_keywords} onChange={(e) => change("search_keywords", e.target.value)} /></Field>
    </FormGrid>
    <Field label="Short description"><textarea className={textCls} maxLength={500} value={d.short_description} onChange={(e) => change("short_description", e.target.value)} /></Field>
    <Field label="Description"><textarea className={textCls} maxLength={8000} value={d.long_description} onChange={(e) => change("long_description", e.target.value)} /></Field>
    <FormGrid>
      <Field label="Ingredients" hint="supplier-approved copy only"><textarea className={textCls} maxLength={5000} value={d.ingredients} onChange={(e) => change("ingredients", e.target.value)} /></Field>
      <Field label="Directions"><textarea className={textCls} maxLength={5000} value={d.directions} onChange={(e) => change("directions", e.target.value)} /></Field>
    </FormGrid>
    <Field label="Warnings" hint="do not invent medical claims"><textarea className={textCls} maxLength={5000} value={d.warnings} onChange={(e) => change("warnings", e.target.value)} /></Field>
  </FormSection>;
}

interface VariantDraft { label: string; sku: string; barcode: string; storefront: string; pos: string; storefrontUsd: string; posUsd: string; reorder: string }
const emptyVariant = (): VariantDraft => ({ label: "Standard", sku: "", barcode: "", storefront: "", pos: "", storefrontUsd: "", posUsd: "", reorder: "0" });
function fromVariant(v: CareVariant): VariantDraft {
  return { label: v.variant_name, sku: v.sku, barcode: v.barcode ?? "", storefront: value(v.price_storefront_ngn), pos: value(v.price_pos_ngn), storefrontUsd: value(v.price_storefront_usd), posUsd: value(v.price_pos_usd), reorder: value(v.reorder_point ?? 0) };
}
function variantFields(v: VariantDraft): CareVariantInput {
  if (!v.label.trim()) throw new Error("Every option needs a label");
  for (const x of [v.storefront, v.pos, v.storefrontUsd, v.posUsd])
    if (x.trim() !== "" && (!Number.isFinite(Number(x)) || Number(x) < 0)) throw new Error("Prices must be nonnegative numbers");
  return { label: v.label.trim(), ...(v.sku.trim() ? { sku: v.sku.trim() } : {}),
    barcode: v.barcode.trim() || null, price_storefront_ngn: num(v.storefront),
    price_pos_ngn: num(v.pos), price_storefront_usd: num(v.storefrontUsd),
    price_pos_usd: num(v.posUsd), reorder_point: Number(v.reorder || 0) };
}
function VariantFields({ v, set, allowSkuEmpty = false }: { v: VariantDraft; set: (v: VariantDraft) => void; allowSkuEmpty?: boolean }) {
  const change = (key: keyof VariantDraft, val: string) => set({ ...v, [key]: val });
  return <div className="space-y-3">
    <FormGrid>
      <Field label="Option label" hint="e.g. Standard / 50 ml"><input className={inputCls} value={v.label} onChange={(e) => change("label", e.target.value)} /></Field>
      <Field label="Exact SKU" hint={allowSkuEmpty ? "simple item: leave blank to use its code" : "required"}><input className={inputCls} value={v.sku} onChange={(e) => change("sku", e.target.value)} /></Field>
      <Field label="Barcode" hint="optional"><input className={inputCls} value={v.barcode} onChange={(e) => change("barcode", e.target.value)} /></Field>
      <Field label="Reorder point"><input type="number" min="0" step="1" className={inputCls} value={v.reorder} onChange={(e) => change("reorder", e.target.value)} /></Field>
      <Field label="Storefront NGN"><input type="number" min="0" step="0.01" className={inputCls} value={v.storefront} onChange={(e) => change("storefront", e.target.value)} /></Field>
      <Field label="Staff/POS NGN"><input type="number" min="0" step="0.01" className={inputCls} value={v.pos} onChange={(e) => change("pos", e.target.value)} /></Field>
      <Field label="Storefront USD" hint="optional"><input type="number" min="0" step="0.01" className={inputCls} value={v.storefrontUsd} onChange={(e) => change("storefrontUsd", e.target.value)} /></Field>
      <Field label="Staff/POS USD" hint="optional"><input type="number" min="0" step="0.01" className={inputCls} value={v.posUsd} onChange={(e) => change("posUsd", e.target.value)} /></Field>
    </FormGrid>
  </div>;
}

function CareCreate() {
  const nav = useNavigate();
  const actions = useCareActions();
  const [d, setD] = useState<Details>({ ...empty });
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const save = async () => {
    try {
      const spec = fields(d);
      const options = variants.map(variantFields);
      if (options.length > 1 && options.some((v) => !v.sku)) throw new Error("Enter an exact SKU for every selectable option");
      const result = await actions.create.mutateAsync({ ...spec, variants: options });
      toast.success("Care item saved as draft");
      nav(`/catalogue/care/${result.product_id}`);
    } catch (e) { error(e); }
  };
  return <div className="max-w-[980px] space-y-4">
    <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => nav("/catalogue?tab=care")}>Care & Accessories</Button>
    <h1 className="font-display text-xl">New care item</h1>
    <p className="text-[12px] text-text-muted">Starts as a draft. Add photos and positive prices before a separate Publish action. No batch or expiry fields.</p>
    <Card className="p-5"><DetailsForm d={d} set={setD} isNew /></Card>
    <Card className="p-5 space-y-4"><div className="micro">Stock-bearing SKUs · options</div>
      {variants.map((v, i) => <div className="p-4 rounded-[12px] border border-line space-y-3" key={i}>
        <div className="flex items-center justify-between text-[12px] font-semibold">Option {i + 1}{i === 0 ? " · default" : ""}
          {i > 0 && <Button size="sm" variant="ghost" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>Remove</Button>}
        </div>
        <VariantFields v={v} allowSkuEmpty={variants.length === 1} set={(next) => setVariants(variants.map((x, j) => i === j ? next : x))} />
      </div>)}
      <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setVariants([...variants, { ...emptyVariant(), label: "" }])}>Add labelled option</Button>
    </Card>
    <div className="flex justify-end"><Button variant="primary" disabled={actions.create.isPending} onClick={save}>{actions.create.isPending ? "Saving…" : "Create draft"}</Button></div>
  </div>;
}

function CareEditor({ p, onBack }: { p: CareProduct; onBack: () => void }) {
  const nav = useNavigate();
  const { can } = useAuthStore();
  const actions = useCareActions();
  const [d, setD] = useState<Details>(() => fromProduct(p));
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | "archive" | "trash" | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  useEffect(() => { setD(fromProduct(p)); }, [p]);
  const act = async () => {
    if (!confirm) return;
    try {
      if (confirm === "publish") await actions.publish.mutateAsync(p.product_id);
      if (confirm === "unpublish" || confirm === "archive") await actions.unpublish.mutateAsync({ id: p.product_id, archive: confirm === "archive" });
      if (confirm === "trash") { await actions.trash.mutateAsync(p.product_id); nav("/catalogue?tab=care"); }
      toast.success(`Care item ${confirm === "publish" ? "published for staff review (public sales remain off)" : confirm === "trash" ? "moved to trash" : confirm === "archive" ? "archived" : "returned to draft"}`);
      setConfirm(null);
    } catch (e) { error(e); }
  };
  const save = async () => {
    try {
      const { product_code: _code, ...patch } = fields(d);
      await actions.update.mutateAsync({ id: p.product_id, patch });
      toast.success("Care details saved · draft review required");
    } catch (e) { error(e); }
  };
  return <div className="max-w-[1020px] space-y-4">
    <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>Care & Accessories</Button>
    <div className="flex items-center flex-wrap gap-3">
      <div><h1 className="font-display text-xl">{p.name}</h1><span className="text-[11px] text-accent-glow font-mono">{p.product_code}</span></div>
      <Pill tone={p.retail_status === "live" ? "success" : "warn"}>{p.retail_status === "live" ? "Published" : p.retail_status}</Pill>
      {can("catalogue", "create") && <Button size="sm" onClick={() => setCloneOpen(true)}>Clone to new draft</Button>}
      {can("catalogue", "approve") && <div className="ml-auto flex gap-2">
        {p.retail_status !== "live" && p.retail_status !== "archived" && <Button variant="primary" size="sm" onClick={() => setConfirm("publish")}>Publish</Button>}
        {p.retail_status === "live" && <Button size="sm" onClick={() => setConfirm("unpublish")}>Unpublish</Button>}
        {p.retail_status !== "archived" && <Button size="sm" onClick={() => setConfirm("archive")}>Archive</Button>}
      </div>}
    </div>
    <p className="text-[12px] text-text-muted">Publication is a catalogue review state in PR1. Customer-facing sales, links and checkout remain disabled until later gated PRs.</p>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_310px] gap-4">
      <div className="space-y-4">
        <Card className="p-5"><DetailsForm d={d} set={setD} isNew={false} />
          {can("catalogue", "edit") && <div className="flex justify-between">
            {can("catalogue", "delete") && <Button size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setConfirm("trash")}>Move to trash</Button>}
            <Button variant="primary" size="sm" disabled={actions.update.isPending} onClick={save}>Save details</Button>
          </div>}
        </Card>
        <Card className="p-5 space-y-4">
          <div className="micro">Exact SKU options · independent stock</div>
          {(p.variants ?? []).map((v) => <CareVariantEditor key={v.variant_id} productId={p.product_id} v={v} canEdit={can("catalogue", "edit")} />)}
          {can("catalogue", "create") && p.retail_status !== "archived" && <NewOption productId={p.product_id} />}
        </Card>
      </div>
      <div className="space-y-4">
        <Card className="p-4 space-y-3"><div className="micro">Product photos</div>
          <p className="text-[11px] text-text-muted">At least one approved product image is required to publish. Photo edits return the item to draft.</p>
          {(p.images ?? []).map((img) => <div key={img.image_id} className="flex gap-2 items-center">
            {img.cdn_url && <img className="w-16 h-16 object-cover rounded-[10px]" src={img.cdn_url} alt={img.alt_text || p.name} />}
            <span className="text-[11px] text-text-muted flex-1 truncate">{img.alt_text || "Product image"}</span>
            {can("catalogue", "edit") && <Button size="sm" variant="ghost" onClick={() => {
              if (window.confirm("Remove this photo? The item returns to draft."))
                actions.removeImage.mutate({ id: p.product_id, imageId: img.image_id }, { onError: error });
            }}>Remove</Button>}
          </div>)}
          {can("catalogue", "edit") && <label className="cursor-pointer inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent-glow">
            <ImagePlus className="w-4 h-4" /> {actions.uploadImage.isPending ? "Uploading…" : "Add image"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" className="sr-only" disabled={actions.uploadImage.isPending} onChange={(e) => {
              const file = e.target.files?.[0]; if (file) actions.uploadImage.mutate({ id: p.product_id, file, alt_text: p.name }, { onSuccess: () => toast.success("Photo saved · item returned to draft"), onError: error });
              e.target.value = "";
            }} />
          </label>}
        </Card>
        <Card className="p-4 text-[12px] space-y-2"><div className="micro">SKU stock</div>
          <div>{Number(p.stock_on_hand ?? 0)} units on hand · {Number(p.stock_available ?? 0)} available</div>
          <p className="text-text-muted">Receive and reconcile each SKU at a stock location from the Care & Accessories tab. No preorder, backorder, batch or expiry tracking.</p>
          <Button size="sm" onClick={onBack}>Open stock tools</Button>
        </Card>
      </div>
    </div>
    {cloneOpen && <CloneCareModal p={p} onClose={() => setCloneOpen(false)} />}
    <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={act}
      title={`${confirm ?? "Change"} care item?`}
      message={confirm === "publish" ? "Confirm category, photo, approved copy and all active SKU prices. Publishing here will NOT enable customer-facing sales." : confirm === "trash" ? "Stock must be zero and any open PO or shipment closed before moving this item to trash." : "This changes the staff catalogue state. Existing stock remains independent."}
      confirmLabel={confirm === "publish" ? "Publish for staff" : "Confirm"} />
  </div>;
}

function CloneCareModal({ p, onClose }: { p: CareProduct; onClose: () => void }) {
  const nav = useNavigate();
  const actions = useCareActions();
  const active = (p.variants ?? []).filter((v) => v.is_active);
  const [name, setName] = useState(`${p.name} Copy`);
  const [codes, setCodes] = useState(active.map((v) => ({ sku: "", label: v.variant_name, barcode: "" })));
  const save = async () => {
    try {
      if (!name.trim() || codes.some((v, i) => !v.sku.trim() || v.sku.trim() === active[i].sku))
        throw new Error("Enter a name and a NEW exact SKU for every option");
      const result = await actions.clone.mutateAsync({ id: p.product_id, input: { name: name.trim(), variants: codes.map((v) => ({ sku: v.sku.trim(), label: v.label.trim(), barcode: v.barcode.trim() || null })) } });
      toast.success("Clone saved as a draft · stock, cost and photos not copied");
      onClose(); nav(`/catalogue/care/${result.product_id}`);
    } catch (e) { error(e); }
  };
  return <Modal open onClose={onClose} title="Clone Care item" size="md">
    <div className="space-y-3 text-[12px]">
      <p className="text-text-muted">Copy approved copy, tax choice and prices. Enter entirely new SKU identities. Photos, stock, cost and barcodes are NOT copied.</p>
      <Field label="New item name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {active.map((v, i) => <div key={v.variant_id} className="rounded-[10px] border border-line p-3 space-y-2">
        <div>{v.variant_name} · old SKU {v.sku}</div>
        <Field label="New exact SKU"><input className={inputCls} value={codes[i]?.sku ?? ""} onChange={(e) => setCodes(codes.map((c, j) => j === i ? { ...c, sku: e.target.value } : c))} /></Field>
        <Field label="New label"><input className={inputCls} value={codes[i]?.label ?? ""} onChange={(e) => setCodes(codes.map((c, j) => j === i ? { ...c, label: e.target.value } : c))} /></Field>
        <Field label="Barcode" hint="optional"><input className={inputCls} value={codes[i]?.barcode ?? ""} onChange={(e) => setCodes(codes.map((c, j) => j === i ? { ...c, barcode: e.target.value } : c))} /></Field>
      </div>)}
      <div className="flex justify-end gap-2"><Button size="sm" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={actions.clone.isPending || !active.length} onClick={save}>Create clone as draft</Button></div>
    </div>
  </Modal>;
}

function CareVariantEditor({ productId, v, canEdit }: { productId: string; v: CareVariant; canEdit: boolean }) {
  const actions = useCareActions();
  const [d, setD] = useState<VariantDraft>(() => fromVariant(v));
  const [editing, setEditing] = useState(false);
  const save = async () => {
    try {
      const patch = variantFields(d);
      if (!patch.sku) throw new Error("An option SKU cannot be blank");
      await actions.editVariant.mutateAsync({ id: productId, variantId: v.variant_id, patch });
      toast.success("SKU updated · item returned to draft"); setEditing(false);
    } catch (e) { error(e); }
  };
  return <div className="border border-line rounded-[12px] p-4 space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div><span className="text-[13px] font-semibold">{v.variant_name}</span>{v.is_default && <span className="text-[11px] text-text-muted"> · default</span>}
        <div className="font-mono text-[11px] text-accent-glow">{v.sku}</div></div>
      <Pill tone={v.is_active ? "success" : "neutral"}>{v.is_active ? "Active" : "Inactive"}</Pill>
    </div>
    <div className="text-[12px] text-text-muted">{Number(v.stock_on_hand ?? 0)} on hand · {Number(v.stock_available ?? 0)} available · {v.has_operational_cost ? "Costed" : "Cost basis missing"}</div>
    <div className="text-[12px]">Storefront: {v.price_storefront_ngn != null ? <MoneyText ngn={Number(v.price_storefront_ngn)} /> : "Not set"} · Staff/POS: {v.price_pos_ngn != null ? <MoneyText ngn={Number(v.price_pos_ngn)} /> : "Not set"}</div>
    {editing && <VariantFields v={d} set={setD} />}
    {canEdit && <div className="flex gap-2 flex-wrap">
      {editing ? <><Button size="sm" onClick={() => { setD(fromVariant(v)); setEditing(false); }}>Cancel</Button><Button size="sm" variant="primary" disabled={actions.editVariant.isPending} onClick={save}>Save SKU</Button></> : <Button size="sm" onClick={() => setEditing(true)}>Edit option / price</Button>}
      {!v.is_default && v.is_active && <Button size="sm" variant="ghost" onClick={() => {
        if (window.confirm(`Deactivate ${v.sku}? Stocked, reserved or still-ordered SKUs cannot be deactivated.`)) actions.removeVariant.mutate({ id: productId, variantId: v.variant_id }, { onSuccess: () => toast.success("Option deactivated"), onError: error });
      }}>Deactivate</Button>}
    </div>}
    <CostVaultSection productId={productId} variant={v} />
  </div>;
}
function NewOption({ productId }: { productId: string }) {
  const actions = useCareActions();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<VariantDraft>({ ...emptyVariant(), label: "", sku: "" });
  return <div>
    {!open ? <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setOpen(true)}>Add labelled SKU</Button> : <div className="space-y-3 border border-line rounded-[12px] p-4">
      <VariantFields v={d} set={setD} />
      <div className="flex gap-2"><Button size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button size="sm" variant="primary" disabled={actions.addVariant.isPending} onClick={async () => {
        try {
          const input = variantFields(d); if (!input.sku) throw new Error("Enter an exact new SKU");
          await actions.addVariant.mutateAsync({ id: productId, input });
          toast.success("SKU added · item returned to draft"); setOpen(false); setD({ ...emptyVariant(), label: "", sku: "" });
        } catch (e) { error(e); }
      }}>Add SKU</Button></div>
    </div>}
  </div>;
}

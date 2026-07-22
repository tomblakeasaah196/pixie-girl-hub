import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Boxes, Factory, Trash2 } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, MoneyText, Pill } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import {
  ErrorState,
  ConfirmDialog,
  NumberField,
  Toggle,
  MultiSelect,
  Select,
} from "@/components/ui/controls";
import { FormSection, Field } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import {
  useBaseProduct,
  useUpdateBaseProduct,
  useDeleteBaseProduct,
  useVariants,
  useAddVariant,
  useSizeConfig,
  type BaseProduct,
  type Variant,
} from "@/lib/catalogue";
import { CostVaultSection } from "./CostVaultSection";
import { BaseProductWizard } from "./BaseProductWizard";
import { CloneAndSizesBar } from "./CloneAndSizesBar";

export function BaseProductPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  return isNew ? <BaseProductWizard /> : <BaseDetail id={id!} />;
}


/* ── Detail ─────────────────────────────────────────────── */
function BaseDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const { can } = useAuthStore();
  const product = useBaseProduct(id);
  useBreadcrumbs([
    { label: "Catalogue", href: "/catalogue" },
    { label: product.data?.name ?? "Base product" },
  ]);

  if (product.isLoading) {
    return (
      <div className="max-w-[920px]">
        <BackBar label="Base product" />
        <Card className="p-6 h-64 animate-pulse">
          <span />
        </Card>
      </div>
    );
  }
  if (product.isError || !product.data) {
    return (
      <div className="max-w-[920px]">
        <BackBar label="Base product" />
        <ErrorState onRetry={() => product.refetch()} />
      </div>
    );
  }

  return (
    <BaseEditor
      p={product.data}
      canEdit={can("catalogue", "edit")}
      canCreate={can("catalogue", "create")}
      onBack={() => nav("/catalogue?tab=base")}
    />
  );
}

function BaseEditor({
  p,
  canEdit,
  canCreate,
  onBack,
}: {
  p: BaseProduct;
  canEdit: boolean;
  canCreate: boolean;
  onBack: () => void;
}) {
  const nav = useNavigate();
  const update = useUpdateBaseProduct(p.product_id);
  const remove = useDeleteBaseProduct();
  const variants = useVariants(p.product_id);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Editable core details (name + descriptors).
  const [name, setName] = useState(p.name);
  const [texture, setTexture] = useState(p.texture_type ?? "");
  const [lace, setLace] = useState(p.lace_type ?? "");
  const [length, setLength] = useState(
    p.hair_length_inches != null ? String(p.hair_length_inches) : "",
  );
  const [capSize, setCapSize] = useState(p.cap_size ?? "");

  // Cap-size choices are sourced from the size config (the configured tiers),
  // plus "Adjustable"; the current value is always included so a legacy/custom
  // cap size still shows.
  const sizeCfg = useSizeConfig();
  const capOptions = useMemo(() => {
    const tierLabels = (sizeCfg.data?.tiers ?? [])
      .filter((t) => t.is_active)
      .map((t) => t.label);
    const set = new Set<string>(tierLabels);
    set.add("Adjustable");
    if (p.cap_size) set.add(p.cap_size);
    return [
      { value: "", label: "—" },
      ...[...set].map((v) => ({ value: v, label: v })),
    ];
  }, [sizeCfg.data, p.cap_size]);

  // Pre-order / production timeline state.
  const [preorder, setPreorder] = useState(p.preorder_enabled);
  const [excluded, setExcluded] = useState(p.preorder_excluded ?? false);
  const [readyDate, setReadyDate] = useState(p.expected_ready_date ?? "");
  const [leadDays, setLeadDays] = useState(
    p.production_lead_days != null ? String(p.production_lead_days) : "",
  );

  useEffect(() => {
    setName(p.name);
    setTexture(p.texture_type ?? "");
    setLace(p.lace_type ?? "");
    setLength(p.hair_length_inches != null ? String(p.hair_length_inches) : "");
    setCapSize(p.cap_size ?? "");
    setPreorder(p.preorder_enabled);
    setExcluded(p.preorder_excluded ?? false);
    setReadyDate(p.expected_ready_date ?? "");
    setLeadDays(
      p.production_lead_days != null ? String(p.production_lead_days) : "",
    );
  }, [p]);

  const detailsDirty =
    name !== p.name ||
    texture !== (p.texture_type ?? "") ||
    lace !== (p.lace_type ?? "") ||
    capSize !== (p.cap_size ?? "") ||
    length !== (p.hair_length_inches != null ? String(p.hair_length_inches) : "");

  const saveDetails = () =>
    update.mutate({
      name: name.trim(),
      texture_type: texture.trim() || null,
      lace_type: lace.trim() || null,
      cap_size: capSize || null,
      hair_length_inches: length ? Number(length) : null,
    } as Partial<BaseProduct>);

  const preorderDirty =
    preorder !== p.preorder_enabled ||
    excluded !== (p.preorder_excluded ?? false) ||
    readyDate !== (p.expected_ready_date ?? "") ||
    leadDays !==
      (p.production_lead_days != null ? String(p.production_lead_days) : "");

  const savePreorder = () =>
    update.mutate({
      preorder_enabled: preorder,
      preorder_excluded: excluded,
      // Normalise to YYYY-MM-DD: the API can return DATE as a full ISO
      // timestamp, and the server validates expected_ready_date as a plain
      // date — sending the raw ISO string would 400.
      expected_ready_date: readyDate ? readyDate.slice(0, 10) : null,
      production_lead_days: leadDays ? Number(leadDays) : null,
    } as Partial<BaseProduct>);

  return (
    <div className="max-w-[960px]">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={onBack}
        >
          Catalogue
        </Button>
        <div>
          <div className="font-display text-xl leading-tight">{p.name}</div>
          <div className="font-mono text-[11px] text-accent-glow">
            {p.product_code}
          </div>
        </div>
        {p.preorder_enabled && (
          <Pill tone="info" dot={false}>
            <Factory className="w-3 h-3" /> Pre-order on
          </Pill>
        )}
        {canCreate && (
          <div className="ml-auto">
            <CloneAndSizesBar product={p} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Details + Variants + stock */}
        <div className="space-y-4">
          {/* Editable core details */}
          <Card className="p-5">
            <FormSection title="Details">
              <Field label="Name">
                <input
                  value={name}
                  disabled={!canEdit}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Texture" hint="optional">
                  <input
                    value={texture}
                    disabled={!canEdit}
                    onChange={(e) => setTexture(e.target.value)}
                    className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
                  />
                </Field>
                <Field label="Lace" hint="optional">
                  <input
                    value={lace}
                    disabled={!canEdit}
                    onChange={(e) => setLace(e.target.value)}
                    className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Length (inches)" hint="optional">
                  <NumberField
                    value={length}
                    onChange={setLength}
                    allowDecimal={false}
                    disabled={!canEdit}
                    suffix='"'
                  />
                </Field>
                <Field label="Cap size" hint="from your size config">
                  <Select
                    value={capSize}
                    onChange={setCapSize}
                    disabled={!canEdit}
                    options={capOptions}
                  />
                </Field>
              </div>
            </FormSection>
            {canEdit && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-faint hover:text-danger transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete base
                </button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!detailsDirty || !name.trim() || update.isPending}
                  onClick={saveDetails}
                >
                  {update.isPending ? "Saving…" : "Save details"}
                </Button>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center mb-3">
              <span className="micro">Variants · stock-bearing</span>
              {canCreate && (
                <Button
                  size="sm"
                  className="ml-auto"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => setAddOpen(true)}
                >
                  Add variant
                </Button>
              )}
            </div>
            {variants.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 rounded-[12px] bg-text-primary/[0.05] animate-pulse"
                  />
                ))}
              </div>
            ) : variants.isError ? (
              <ErrorState onRetry={() => variants.refetch()} />
            ) : (variants.data ?? []).length === 0 ? (
              <div className="text-[12.5px] text-text-faint py-4 text-center">
                No variants yet. Add one to hold stock and pricing.
              </div>
            ) : (
              <div className="space-y-3">
                {(variants.data ?? []).map((v) => (
                  <VariantRow
                    key={v.variant_id}
                    productId={p.product_id}
                    v={v}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Pre-order / production timeline */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="micro mb-3">Pre-order · production</div>
            <p className="text-[11px] text-text-faint mb-3">
              Pre-orders are on for the whole catalogue (Catalogue → Config).
              When this base runs out, its styled listings are offered as a
              pre-order on the brand window — unless you exclude it below.
            </p>
            <Toggle
              checked={excluded}
              onChange={setExcluded}
              disabled={!canEdit}
              label="Exclude from pre-orders (show “Sold out” instead)"
            />
            {!excluded && (
              <div className="mt-3 space-y-3">
                <Toggle
                  checked={preorder}
                  onChange={setPreorder}
                  disabled={!canEdit}
                  label="Use a custom production window for this product"
                />
                {preorder && (
                  <>
                    <Field label="Expected ready date" hint="optional">
                      <input
                        type="date"
                        value={readyDate ? readyDate.slice(0, 10) : ""}
                        disabled={!canEdit}
                        onChange={(e) => setReadyDate(e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Production lead days" hint="used if no date">
                      <NumberField
                        value={leadDays}
                        onChange={setLeadDays}
                        allowDecimal={false}
                        disabled={!canEdit}
                        suffix="days"
                      />
                    </Field>
                    <p className="text-[11px] text-text-faint">
                      When stock hits zero, styled listings show “In production ·
                      ready ~
                      {readyDate ? formatDate(readyDate) : "{date}"}
                      ” instead of the brand’s default window.
                    </p>
                  </>
                )}
              </div>
            )}
            {canEdit && (
              <Button
                variant="primary"
                size="sm"
                className="mt-3 w-full"
                disabled={!preorderDirty || update.isPending}
                onClick={savePreorder}
              >
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </Card>
          <LaceCard p={p} canEdit={canEdit} />
        </div>
      </div>

      {canCreate && (
        <AddVariantModal
          productId={p.product_id}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(p.product_id, {
            onSuccess: () => nav("/catalogue?tab=base"),
          })
        }
        title="Delete base product?"
        message="This moves the base product to Trash and frees its name. Styled listings that draw from it keep their own data; stock records are detached."
        confirmLabel="Delete"
        busy={remove.isPending}
      />
    </div>
  );
}

/** Supported lace constructions on the base — the styled products built on it
 *  inherit this set as their lace axis (and may narrow it). */
function LaceCard({ p, canEdit }: { p: BaseProduct; canEdit: boolean }) {
  const update = useUpdateBaseProduct(p.product_id);
  const cfg = useSizeConfig();
  const ladder = (cfg.data?.lace_sizes ?? []).filter((l) => l.is_active);
  const [codes, setCodes] = useState<string[]>(p.lace_size_codes ?? []);

  useEffect(() => setCodes(p.lace_size_codes ?? []), [p]);

  const dirty =
    JSON.stringify([...codes].sort()) !==
    JSON.stringify([...(p.lace_size_codes ?? [])].sort());

  if (!ladder.length && !codes.length) {
    return (
      <Card className="p-4">
        <div className="micro mb-1">Lace</div>
        <p className="text-[11.5px] text-text-faint">
          No lace ladder set up yet. Add lace sizes under Catalogue → Config to
          offer 13×4, 360, etc.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="micro mb-2">Supported lace</div>
      <MultiSelect
        values={codes}
        onChange={setCodes}
        options={ladder.map((l) => ({ value: l.lace_code, label: l.label }))}
      />
      <p className="text-[11px] text-text-faint mt-2">
        Styled products on this base offer these lace constructions; each one
        becomes part of the colour × size × lace matrix.
      </p>
      {canEdit && (
        <Button
          variant="primary"
          size="sm"
          className="mt-3 w-full"
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate({ lace_size_codes: codes } as Partial<BaseProduct>)
          }
        >
          {update.isPending ? "Saving…" : "Save lace"}
        </Button>
      )}
    </Card>
  );
}

function VariantRow({ productId, v }: { productId: string; v: Variant }) {
  return (
    <div className="rounded-[12px] border hairline p-3 bg-text-primary/[0.02] space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate">
            {v.variant_name ?? v.sku ?? "Variant"}
          </div>
          <div className="font-mono text-[10.5px] text-text-faint">{v.sku}</div>
        </div>
        {v.is_default && (
          <Pill tone="accent" dot={false}>
            Default
          </Pill>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div>
          <div className="micro">Storefront</div>
          {v.price_storefront_ngn != null ? (
            <MoneyText ngn={v.price_storefront_ngn} className="text-[13px]" />
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </div>
        <div>
          <div className="micro">Wholesale</div>
          {v.price_wholesale_ngn != null ? (
            <MoneyText ngn={v.price_wholesale_ngn} className="text-[13px]" />
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </div>
      </div>
      {/* Cost vault — renders only for grantees (server-confirmed). */}
      <CostVaultSection productId={productId} variant={v} />
    </div>
  );
}

function AddVariantModal({
  productId,
  open,
  onClose,
}: {
  productId: string;
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddVariant(productId);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [storefront, setStorefront] = useState("");
  const [storefrontUsd, setStorefrontUsd] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [wholesaleUsd, setWholesaleUsd] = useState("");

  const submit = () => {
    if (!sku.trim() || !name.trim()) return;
    add.mutate(
      {
        sku: sku.trim(),
        variant_name: name.trim(),
        price_storefront_ngn: storefront ? Number(storefront) : undefined,
        price_storefront_usd: storefrontUsd ? Number(storefrontUsd) : undefined,
        price_wholesale_ngn: wholesale ? Number(wholesale) : undefined,
        price_wholesale_usd: wholesaleUsd ? Number(wholesaleUsd) : undefined,
      } as Partial<Variant>,
      {
        onSuccess: () => {
          setSku("");
          setName("");
          setStorefront("");
          setStorefrontUsd("");
          setWholesale("");
          setWholesaleUsd("");
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add variant"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!sku.trim() || !name.trim() || add.isPending}
            onClick={submit}
          >
            {add.isPending ? "Adding…" : "Add"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className={`${inputCls} font-mono`} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
          <Field label="Variant name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Storefront price" hint="Naira">
            <NumberField
              value={storefront}
              onChange={setStorefront}
              suffix="₦"
            />
          </Field>
          <Field label="Storefront price" hint="US Dollar">
            <NumberField
              value={storefrontUsd}
              onChange={setStorefrontUsd}
              suffix="$"
            />
          </Field>
          <Field label="Wholesale price" hint="Naira">
            <NumberField value={wholesale} onChange={setWholesale} suffix="₦" />
          </Field>
          <Field label="Wholesale price" hint="US Dollar">
            <NumberField
              value={wholesaleUsd}
              onChange={setWholesaleUsd}
              suffix="$"
            />
          </Field>
        </div>
        <p className="text-[11px] text-text-faint">
          Set Naira and US Dollar prices directly — leave a currency blank to
          skip it. True cost + supplier live in the cost vault, never here.
        </p>
        {add.isError && (
          <p className="text-[12px] text-danger">
            {add.error instanceof Error
              ? add.error.message
              : "Could not add variant."}
          </p>
        )}
      </div>
    </Modal>
  );
}

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 disabled:opacity-60";

function BackBar({ label }: { label: string }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-3 mb-4">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="w-4 h-4" />}
        onClick={() => nav("/catalogue?tab=base")}
      >
        Catalogue
      </Button>
      <span className="font-display text-lg flex items-center gap-2">
        <Boxes className="w-4 h-4 text-accent-glow" /> {label}
      </span>
    </div>
  );
}

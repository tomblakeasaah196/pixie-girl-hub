import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Boxes, Factory } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, MoneyText, Pill } from "@/components/ui/primitives";
import { ErrorState, NumberField, Toggle } from "@/components/ui/controls";
import { FormSection, Field } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import {
  useBaseProduct,
  useCreateBaseProduct,
  useUpdateBaseProduct,
  useVariants,
  useAddVariant,
  type BaseProduct,
  type Variant,
} from "@/lib/catalogue";
import { CostVaultSection } from "./CostVaultSection";
import { AddToCollection } from "./AddToCollection";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function BaseProductPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  return isNew ? <BaseCreate /> : <BaseDetail id={id!} />;
}

/* ── Create ─────────────────────────────────────────────── */
function BaseCreate() {
  const nav = useNavigate();
  useBreadcrumbs([
    { label: "Catalogue", href: "/catalogue" },
    { label: "New base product" },
  ]);
  const create = useCreateBaseProduct();
  const [name, setName] = useState("");
  const [texture, setTexture] = useState("");
  const [lace, setLace] = useState("");
  const [length, setLength] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    // No product_code: the server allocates the next one from Document
    // Numbering (e.g. FLH001N). Slug is derived from the name.
    create.mutate(
      {
        name: name.trim(),
        slug: slugify(name),
        texture_type: texture || undefined,
        lace_type: lace || undefined,
        hair_length_inches: length ? Number(length) : undefined,
      } as Partial<BaseProduct>,
      { onSuccess: (p) => nav(`/catalogue/base/${p.product_id}`) },
    );
  };

  return (
    <div className="max-w-[640px]">
      <BackBar label="New base product" />
      <Card className="p-5">
        <p className="text-[12.5px] text-text-muted mb-4">
          A base product is a China-origin, stock-bearing item — the only place
          stock lives. Styled listings draw down from it.
        </p>
        <FormSection title="Basics">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Product code" hint="generated automatically">
            <div
              className={`${inputCls} font-mono flex items-center text-text-faint`}
            >
              Assigned on save · e.g. FLH001N
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Texture" hint="optional">
              <input
                value={texture}
                onChange={(e) => setTexture(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Lace" hint="optional">
              <input
                value={lace}
                onChange={(e) => setLace(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Length (inches)" hint="optional">
            <NumberField
              value={length}
              onChange={setLength}
              allowDecimal={false}
              suffix='"'
            />
          </Field>
        </FormSection>
        {create.isError && (
          <p className="text-[12px] text-danger mb-3">
            {create.error instanceof Error
              ? create.error.message
              : "Could not create."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => nav("/catalogue")}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || create.isPending}
            onClick={submit}
          >
            {create.isPending ? "Creating…" : "Create base product"}
          </Button>
        </div>
      </Card>
    </div>
  );
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
      onBack={() => nav("/catalogue")}
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
  const update = useUpdateBaseProduct(p.product_id);
  const variants = useVariants(p.product_id);
  const [addOpen, setAddOpen] = useState(false);

  // Pre-order / production timeline state.
  const [preorder, setPreorder] = useState(p.preorder_enabled);
  const [readyDate, setReadyDate] = useState(p.expected_ready_date ?? "");
  const [leadDays, setLeadDays] = useState(
    p.production_lead_days != null ? String(p.production_lead_days) : "",
  );

  useEffect(() => {
    setPreorder(p.preorder_enabled);
    setReadyDate(p.expected_ready_date ?? "");
    setLeadDays(
      p.production_lead_days != null ? String(p.production_lead_days) : "",
    );
  }, [p]);

  const preorderDirty =
    preorder !== p.preorder_enabled ||
    readyDate !== (p.expected_ready_date ?? "") ||
    leadDays !==
      (p.production_lead_days != null ? String(p.production_lead_days) : "");

  const savePreorder = () =>
    update.mutate({
      preorder_enabled: preorder,
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Variants + stock */}
        <div className="space-y-4">
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
            <Toggle
              checked={preorder}
              onChange={setPreorder}
              disabled={!canEdit}
              label="Allow pre-order when out of stock"
            />
            {preorder && (
              <div className="mt-3 space-y-3">
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
                  {readyDate
                    ? new Date(readyDate).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : "{date}"}
                  ”.
                </p>
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
          {canEdit && (
            <Card className="p-4">
              <AddToCollection productId={p.product_id} />
            </Card>
          )}
        </div>
      </div>

      {canCreate && (
        <AddVariantModal
          productId={p.product_id}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
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
  const [wholesale, setWholesale] = useState("");

  const submit = () => {
    if (!sku.trim() || !name.trim()) return;
    add.mutate(
      {
        sku: sku.trim(),
        variant_name: name.trim(),
        price_storefront_ngn: storefront ? Number(storefront) : undefined,
        price_wholesale_ngn: wholesale ? Number(wholesale) : undefined,
      } as Partial<Variant>,
      {
        onSuccess: () => {
          setSku("");
          setName("");
          setStorefront("");
          setWholesale("");
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
              className={`${inputCls} font-mono`}
            />
          </Field>
          <Field label="Variant name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Storefront price">
            <NumberField
              value={storefront}
              onChange={setStorefront}
              suffix="₦"
            />
          </Field>
          <Field label="Wholesale price">
            <NumberField value={wholesale} onChange={setWholesale} suffix="₦" />
          </Field>
        </div>
        <p className="text-[11px] text-text-faint">
          True cost + supplier are set separately in the cost vault — never
          here.
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
        onClick={() => nav("/catalogue")}
      >
        Catalogue
      </Button>
      <span className="font-display text-lg flex items-center gap-2">
        <Boxes className="w-4 h-4 text-accent-glow" /> {label}
      </span>
    </div>
  );
}

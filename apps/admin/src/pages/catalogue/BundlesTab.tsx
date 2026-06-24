import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Gift,
  X,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Upload,
  Search,
} from "lucide-react";
import { useAddBundleToCampaign, type Campaign } from "@/lib/campaigns";
import { CampaignPickerDropdown } from "@/components/campaign/CampaignPickerDropdown";
import {
  Button,
  Card,
  EmptyState,
  MoneyText,
  Pill,
} from "@/components/ui/primitives";
import {
  ErrorState,
  DeniedState,
  ConfirmDialog,
  Toggle,
  Select,
  NumberField,
} from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useBundles,
  useCreateBundle,
  useToggleBundle,
  useUpdateBundle,
  useDeleteBundle,
  useBundle,
  useAddBundleComponent,
  useRemoveBundleComponent,
  useAddStyledToBundle,
  useBaseProducts,
  useStyledProducts,
  useUploadCoverImage,
  useAllowBaseInCollectionsBundles,
  type Bundle,
  type BundleComponentInput,
  type BundleCreateInput,
} from "@/lib/catalogue";
import { CoverImageEditor } from "./CoverImageEditor";
import { ImportExportControls } from "@/components/catalogue/ImportExportControls";

/**
 * Bundles run on the promotional engine in the retention module
 * (bundle_offers), surfaced here as a Catalogue tab. Permissions follow the
 * `retention` key (not catalogue), so the UI gates on those.
 *
 * Pricing in plain terms (owner-confirmed):
 *  • Fixed bundle price — one flat price for the whole bundle.
 *  • % off — take a percentage off the total of everything inside.
 *  • Amount off — take a fixed ₦ amount off the whole bundle. It STAYS THE SAME
 *    no matter how many products you add (a flat, per-bundle discount).
 */
const PRICING_MODELS = [
  { value: "fixed_bundle_price", label: "Fixed bundle price" },
  { value: "pct_off", label: "% off the bundle total" },
  { value: "amount_off", label: "Fixed ₦ off the bundle" },
];

const PRICING_HELP: Record<string, string> = {
  fixed_bundle_price:
    "One flat price for the whole bundle, whatever it contains.",
  pct_off:
    "Take this percentage off the total of everything in the bundle (scales naturally as you add products).",
  amount_off:
    "Take this fixed ₦ amount off the whole bundle. It stays the same no matter how many products you add.",
};

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

function code(name: string) {
  return name
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function BundlesTab() {
  const { can } = useAuthStore();
  const bundles = useBundles();
  const toggle = useToggleBundle();
  const [open, setOpen] = useState(false);
  const [coverFor, setCoverFor] = useState<Bundle | null>(null);
  const [editFor, setEditFor] = useState<Bundle | null>(null);

  if (!can("retention", "view")) {
    return (
      <DeniedState message="Bundles are part of Retention. Ask an admin for Retention access in Org & Workflow." />
    );
  }
  const canCreate = can("retention", "create");
  const canEdit = can("retention", "edit");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {canCreate && (
          <ImportExportControls
            label="Bundles"
            templatePath="/catalogue/bundles/import-template"
            exportPath="/catalogue/bundles/export"
            importPath="/catalogue/bundles/import"
            onImported={() => bundles.refetch()}
          />
        )}
        {canCreate && (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setOpen(true)}
          >
            New bundle
          </Button>
        )}
      </div>

      {bundles.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="glass rounded-[var(--radius)] h-24 animate-pulse"
            />
          ))}
        </div>
      ) : bundles.isError ? (
        <ErrorState onRetry={() => bundles.refetch()} />
      ) : (bundles.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gift className="w-8 h-8" />}
            title="No bundles yet"
            message="Bundle base products into a promotional offer."
            action={
              canCreate ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setOpen(true)}
                >
                  New bundle
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(bundles.data ?? []).map((b: Bundle) => (
            <Card key={b.bundle_id} className="p-4">
              <div className="aspect-[16/9] -mx-4 -mt-4 mb-3 overflow-hidden rounded-t-[var(--radius)] bg-text-primary/[0.04] relative group">
                {b.hero_image_url ? (
                  <img
                    src={b.hero_image_url}
                    alt={b.display_name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-text-faint">
                    <ImageIcon className="w-7 h-7" />
                  </div>
                )}
                {canEdit && (
                  <button
                    onClick={() => setCoverFor(b)}
                    className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 h-7 rounded-[8px] text-[11px] font-semibold dropglass text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="w-3 h-3" /> Cover
                  </button>
                )}
              </div>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className="font-display text-[15px] truncate">
                    {b.display_name}
                  </div>
                  <div className="font-mono text-[10.5px] text-accent-glow">
                    {b.bundle_code}
                  </div>
                </div>
                {canEdit ? (
                  <Toggle
                    checked={b.is_active}
                    onChange={(v) =>
                      toggle.mutate({ id: b.bundle_id, is_active: v })
                    }
                  />
                ) : (
                  <Pill tone={b.is_active ? "success" : "neutral"} dot={false}>
                    {b.is_active ? "Active" : "Off"}
                  </Pill>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Pill tone="info" dot={false}>
                  {b.pricing_model.replace(/_/g, " ")}
                </Pill>
                {b.bundle_price_ngn != null && (
                  <MoneyText
                    ngn={b.bundle_price_ngn}
                    usd={b.bundle_price_usd ?? undefined}
                    className="text-[14px]"
                  />
                )}
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditFor(b)}
                  className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-glow"
                >
                  <Pencil className="w-3 h-3" /> Edit & manage products
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateBundleModal open={open} onClose={() => setOpen(false)} />
      <BundleCoverModal bundle={coverFor} onClose={() => setCoverFor(null)} />
      <BundleEditorModal bundle={editFor} onClose={() => setEditFor(null)} />
    </div>
  );
}

function BundleCoverModal({
  bundle,
  onClose,
}: {
  bundle: Bundle | null;
  onClose: () => void;
}) {
  const update = useUpdateBundle();
  if (!bundle) return null;
  const save = (url: string | null) =>
    update.mutate(
      { id: bundle.bundle_id, patch: { hero_image_url: url } },
      { onSuccess: onClose },
    );
  return (
    <Modal open onClose={onClose} title={`Cover — ${bundle.display_name}`}>
      <CoverImageEditor
        value={bundle.hero_image_url}
        referenceType="bundle"
        referenceId={bundle.bundle_id}
        onChange={save}
      />
    </Modal>
  );
}

/** Full editor: rename, change pricing (NGN + USD), add/remove products, delete. */
function BundleEditorModal({
  bundle,
  onClose,
}: {
  bundle: Bundle | null;
  onClose: () => void;
}) {
  const detail = useBundle(bundle?.bundle_id ?? null);
  const update = useUpdateBundle();
  const del = useDeleteBundle();
  const addComp = useAddBundleComponent(bundle?.bundle_id ?? "");
  const addStyled = useAddStyledToBundle();
  const removeComp = useRemoveBundleComponent(bundle?.bundle_id ?? "");
  const bases = useBaseProducts();
  const styledProducts = useStyledProducts();
  const allowBase = useAllowBaseInCollectionsBundles();
  const addToCampaign = useAddBundleToCampaign();

  const [name, setName] = useState("");
  const [model, setModel] = useState("fixed_bundle_price");
  const [priceNgn, setPriceNgn] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [amount, setAmount] = useState("");
  const [pick, setPick] = useState("");
  const [pickStyled, setPickStyled] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [campaignFeedback, setCampaignFeedback] = useState<string | null>(null);

  const handleAddToCampaign = (campaign: Campaign) => {
    if (!bundle) return;
    addToCampaign.mutate(
      {
        campaignId: campaign.campaign_id,
        campaignSlug: campaign.slug,
        bundleOfferId: bundle.bundle_id,
      },
      {
        onSuccess: () => {
          setCampaignFeedback(`Added to "${campaign.name}"`);
          setTimeout(() => setCampaignFeedback(null), 3000);
        },
        onError: (err) => {
          setCampaignFeedback(
            err instanceof Error ? err.message : "Could not add to campaign.",
          );
          setTimeout(() => setCampaignFeedback(null), 4000);
        },
      },
    );
  };

  useEffect(() => {
    if (bundle) {
      setName(bundle.display_name);
      setModel(bundle.pricing_model);
      setPriceNgn(
        bundle.bundle_price_ngn != null ? String(bundle.bundle_price_ngn) : "",
      );
      setPriceUsd(
        bundle.bundle_price_usd != null ? String(bundle.bundle_price_usd) : "",
      );
      // pct_off stores a fraction (0.10) — show it as a whole percent.
      setAmount(
        bundle.discount_value != null
          ? String(
              bundle.pricing_model === "pct_off"
                ? bundle.discount_value * 100
                : bundle.discount_value,
            )
          : "",
      );
      setPick("");
      setPickStyled("");
    }
  }, [bundle]);

  if (!bundle) return null;

  const components = detail.data?.components ?? [];
  const componentIds = new Set(components.map((c) => c.product_id));
  const componentStyledIds = new Set(
    components.filter((c) => c.styled_id).map((c) => c.styled_id),
  );
  const pickOptions = allowBase
    ? [
        { value: "", label: "Add a base product…" },
        ...(bases.data ?? [])
          .filter((b) => !componentIds.has(b.product_id))
          .map((b) => ({
            value: b.product_id,
            label: `${b.name} · ${b.product_code}`,
          })),
      ]
    : [];
  const styledPickOptions = [
    { value: "", label: "Add a styled product…" },
    ...(styledProducts.data ?? [])
      .filter((s) => !componentStyledIds.has(s.styled_id))
      .map((s) => ({ value: s.styled_id, label: s.name })),
  ];

  // Live subtotal preview from component unit prices × quantity.
  const subtotal = components.reduce(
    (sum, c) => sum + (c.unit_price_ngn ?? 0) * (c.quantity ?? 1),
    0,
  );

  const saveMeta = () => {
    const num = amount ? Number(amount) : undefined;
    const patch: Partial<Bundle> = {
      display_name: name.trim(),
      pricing_model: model,
    };
    if (model === "fixed_bundle_price") {
      patch.bundle_price_ngn = priceNgn ? Number(priceNgn) : 0;
      patch.bundle_price_usd = priceUsd ? Number(priceUsd) : null;
    } else if (model === "pct_off") {
      patch.discount_value = (num ?? 0) / 100;
    } else if (model === "amount_off") {
      patch.discount_value = num ?? 0;
    }
    update.mutate({ id: bundle.bundle_id, patch });
  };

  const add = (productId: string) => {
    if (!productId) return;
    addComp.mutate({ product_id: productId, quantity: 1, role: "core" });
    setPick("");
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit — ${bundle.display_name}`}
      footer={
        <>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-faint hover:text-danger transition-colors mr-auto"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete bundle
          </button>
          {campaignFeedback && (
            <span
              className={
                campaignFeedback.startsWith("Added")
                  ? "text-[12px] text-success"
                  : "text-[12px] text-danger"
              }
            >
              {campaignFeedback}
            </span>
          )}
          <CampaignPickerDropdown
            label="Add to campaign"
            busy={addToCampaign.isPending}
            onSelect={handleAddToCampaign}
          />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || update.isPending}
            onClick={saveMeta}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Pricing model">
          <Select value={model} onChange={setModel} options={PRICING_MODELS} />
        </Field>
        <p className="text-[11.5px] text-accent-glow font-medium -mt-1">
          {PRICING_HELP[model]}
        </p>

        {model === "fixed_bundle_price" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bundle price" hint="Naira">
              <NumberField value={priceNgn} onChange={setPriceNgn} suffix="₦" />
            </Field>
            <Field label="Bundle price" hint="US Dollar">
              <NumberField value={priceUsd} onChange={setPriceUsd} suffix="$" />
            </Field>
          </div>
        ) : (
          <Field
            label={model === "pct_off" ? "Discount percentage" : "Discount amount"}
            hint={model === "pct_off" ? "percent off the total" : "flat ₦ off the bundle"}
          >
            <NumberField
              value={amount}
              onChange={setAmount}
              suffix={model === "pct_off" ? "%" : "₦"}
            />
          </Field>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="micro">Products in this bundle</div>
            {subtotal > 0 && (
              <div className="text-[11px] text-text-faint">
                Components total <MoneyText ngn={subtotal} className="text-[12px]" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Select
              value={pickStyled}
              onChange={(id) => {
                if (!id) return;
                addStyled.mutate({ bundleId: bundle.bundle_id, styledId: id });
                setPickStyled("");
              }}
              options={styledPickOptions}
            />
            {allowBase && (
              <Select value={pick} onChange={add} options={pickOptions} />
            )}
          </div>
          <div className="mt-3 space-y-2">
            {detail.isLoading ? (
              <div className="h-10 rounded-[11px] bg-text-primary/[0.05] animate-pulse" />
            ) : components.length === 0 ? (
              <p className="text-[11.5px] text-text-faint">
                No products yet. A bundle needs at least one product.
              </p>
            ) : (
              components.map((c) => (
                <div
                  key={c.bundle_product_id}
                  className="flex items-center gap-2 rounded-[11px] border border-line bg-text-primary/[0.03] px-3 py-2"
                >
                  <span className="flex-1 min-w-0 truncate text-[13px]">
                    {c.styled_name ?? c.product_name ?? c.product_code ?? "Product"}
                    {c.styled_name && (
                      <span className="ml-1.5 inline-flex align-middle">
                        <Pill tone="accent" dot={false}>
                          styled
                        </Pill>
                      </span>
                    )}
                    {c.quantity > 1 && (
                      <span className="text-text-faint"> × {c.quantity}</span>
                    )}
                  </span>
                  {c.unit_price_ngn != null && (
                    <MoneyText
                      ngn={c.unit_price_ngn}
                      className="text-[12px] text-text-faint"
                    />
                  )}
                  <button
                    onClick={() => removeComp.mutate(c.bundle_product_id)}
                    disabled={removeComp.isPending}
                    className="grid place-items-center w-7 h-7 rounded-[8px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                    aria-label="Remove product"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.mutate(bundle.bundle_id, {
            onSuccess: () => {
              setConfirmDelete(false);
              onClose();
            },
          })
        }
        title="Delete bundle?"
        message="This removes the bundle offer. The base products inside it are not affected."
        confirmLabel="Delete"
        busy={del.isPending}
      />
    </Modal>
  );
}

function CreateBundleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateBundle();
  const upload = useUploadCoverImage();
  const update = useUpdateBundle();
  const styledProds = useStyledProducts();
  const [name, setName] = useState("");
  const [model, setModel] = useState("fixed_bundle_price");
  const [amount, setAmount] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [components, setComponents] = useState<
    { styled_id: string; name: string; quantity: number }[]
  >([]);
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName("");
    setAmount("");
    setAmountUsd("");
    setModel("fixed_bundle_price");
    setComponents([]);
    setQuery("");
    setShowDropdown(false);
    setCoverFile(null);
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(null);
  };

  const q = query.toLowerCase();
  const hits =
    q.length >= 1
      ? (styledProds.data ?? [])
          .filter(
            (s) =>
              s.name?.toLowerCase().includes(q) &&
              !components.some((c) => c.styled_id === s.styled_id),
          )
          .slice(0, 10)
      : [];

  const addStyled = (s: { styled_id: string; name: string }) => {
    if (components.some((c) => c.styled_id === s.styled_id)) return;
    setComponents((prev) => [
      ...prev,
      { styled_id: s.styled_id, name: s.name, quantity: 1 },
    ]);
    setQuery("");
    setShowDropdown(false);
  };

  const setQty = (styledId: string, qty: number) =>
    setComponents((prev) =>
      prev.map((c) =>
        c.styled_id === styledId ? { ...c, quantity: Math.max(1, qty) } : c,
      ),
    );

  const removeComponent = (styledId: string) =>
    setComponents((prev) => prev.filter((c) => c.styled_id !== styledId));

  const canSubmit = !!name.trim() && components.length > 0 && !create.isPending;

  const submit = () => {
    if (!name.trim() || components.length === 0) return;
    const num = amount ? Number(amount) : undefined;
    const payloadComponents: BundleComponentInput[] = components.map((c) => ({
      styled_id: c.styled_id,
      quantity: c.quantity,
      role: "core",
    }));
    const payload: BundleCreateInput = {
      bundle_code: code(name),
      display_name: name.trim(),
      pricing_model: model,
      components: payloadComponents,
    };
    if (model === "fixed_bundle_price") {
      payload.bundle_price_ngn = num ?? 0;
      payload.bundle_price_usd = amountUsd ? Number(amountUsd) : undefined;
    } else if (model === "pct_off") {
      // priceBundle expects a FRACTION (0.10 for 10%), not a whole percent.
      payload.discount_value = (num ?? 0) / 100;
    } else {
      payload.discount_value = num ?? 0;
    }
    create.mutate(payload, {
      onSuccess: (bundle) => {
        if (coverFile) {
          upload.mutate(
            {
              file: coverFile,
              reference_type: "bundle",
              reference_id: bundle.bundle_id,
            },
            {
              onSuccess: (res) => {
                update.mutate({
                  id: bundle.bundle_id,
                  patch: { hero_image_url: res.cdn_url },
                });
              },
            },
          );
        }
        reset();
        onClose();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New bundle"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Cover image" hint="optional">
          <div className="space-y-2">
            {coverPreview ? (
              <div className="relative aspect-[16/9] rounded-[11px] overflow-hidden border border-line">
                <img
                  src={coverPreview}
                  alt="Cover preview"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(coverPreview);
                    setCoverFile(null);
                    setCoverPreview(null);
                  }}
                  className="absolute top-2 right-2 grid place-items-center w-6 h-6 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverFileRef.current?.click()}
                className="w-full h-[72px] rounded-[11px] border border-dashed border-line hover:border-accent/60 flex flex-col items-center justify-center gap-1 text-text-faint hover:text-accent-glow transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span className="text-[11.5px]">Choose cover image</span>
              </button>
            )}
            <input
              ref={coverFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setCoverFile(file);
                setCoverPreview(URL.createObjectURL(file));
                e.target.value = "";
              }}
            />
          </div>
        </Field>

        <Field label="Pricing model">
          <Select value={model} onChange={setModel} options={PRICING_MODELS} />
        </Field>
        <p className="text-[11.5px] text-accent-glow font-medium -mt-1">
          {PRICING_HELP[model]}
        </p>

        {model === "fixed_bundle_price" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bundle price" hint="Naira">
              <NumberField value={amount} onChange={setAmount} suffix="₦" />
            </Field>
            <Field label="Bundle price" hint="US Dollar">
              <NumberField
                value={amountUsd}
                onChange={setAmountUsd}
                suffix="$"
              />
            </Field>
          </div>
        ) : (
          <Field
            label={model === "pct_off" ? "Discount percentage" : "Discount amount"}
            hint={
              model === "pct_off" ? "percent off the total" : "flat ₦ off the bundle"
            }
          >
            <NumberField
              value={amount}
              onChange={setAmount}
              suffix={model === "pct_off" ? "%" : "₦"}
            />
          </Field>
        )}

        <Field label="Styled products in this bundle" hint="at least one">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Type to search styled products…"
              className={`${inputCls} pl-9`}
            />
            {showDropdown && hits.length > 0 && (
              <div className="absolute z-50 top-full mt-1 left-0 right-0 glass border border-line rounded-[11px] shadow-lg max-h-[220px] overflow-y-auto">
                {hits.map((s) => (
                  <button
                    key={s.styled_id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addStyled(s);
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-text-primary/[0.05] transition-colors first:rounded-t-[11px] last:rounded-b-[11px]"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        {components.length > 0 && (
          <div className="space-y-2">
            {components.map((c) => (
              <div
                key={c.styled_id}
                className="flex items-center gap-2 rounded-[11px] border border-line bg-text-primary/[0.03] px-3 py-2"
              >
                <span className="flex-1 min-w-0 truncate text-[13px]">
                  {c.name}
                </span>
                <input
                  type="number"
                  min={1}
                  value={c.quantity}
                  onChange={(e) => setQty(c.styled_id, Number(e.target.value))}
                  className="w-14 h-8 px-2 rounded-[8px] bg-text-primary/[0.05] border border-line text-text-primary text-[12px] text-center outline-none focus:border-accent/50"
                  aria-label="Quantity"
                />
                <button
                  onClick={() => removeComponent(c.styled_id)}
                  className="grid place-items-center w-7 h-7 rounded-[8px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                  aria-label="Remove product"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {components.length === 0 && (
          <p className="text-[11.5px] text-text-faint">
            Search and pick styled products for this bundle. A bundle needs at
            least one.
          </p>
        )}

        {create.isError && (
          <p className="text-[12px] text-danger">
            {create.error instanceof Error
              ? create.error.message
              : "Could not create bundle."}
          </p>
        )}
      </div>
    </Modal>
  );
}

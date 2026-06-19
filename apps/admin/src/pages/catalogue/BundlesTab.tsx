import { useState } from "react";
import { Plus, Gift, X } from "lucide-react";
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
  useBaseProducts,
  type Bundle,
  type BundleComponentInput,
  type BundleCreateInput,
} from "@/lib/catalogue";

/**
 * Bundles run on the promotional engine in the retention module
 * (bundle_offers), surfaced here as a Catalogue tab. Permissions follow the
 * `retention` key (not catalogue), so the UI gates on those.
 */
const PRICING_MODELS = [
  { value: "fixed_bundle_price", label: "Fixed bundle price" },
  { value: "pct_off", label: "% off components" },
  { value: "amount_off", label: "Amount off components" },
];

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

  if (!can("retention", "view")) {
    return (
      <DeniedState message="Bundles are part of Retention. Ask an admin for Retention access in Org & Workflow." />
    );
  }
  const canCreate = can("retention", "create");
  const canEdit = can("retention", "edit");

  return (
    <div className="space-y-5">
      <div className="flex items-center">
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
            message="Bundle styled products into a promotional offer."
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
                  <MoneyText ngn={b.bundle_price_ngn} className="text-[14px]" />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateBundleModal open={open} onClose={() => setOpen(false)} />
    </div>
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
  const bases = useBaseProducts();
  const [name, setName] = useState("");
  const [model, setModel] = useState("fixed_bundle_price");
  const [amount, setAmount] = useState("");
  // A bundle MUST have ≥1 component (server-enforced). We pick base products.
  const [components, setComponents] = useState<
    { product_id: string; name: string; quantity: number }[]
  >([]);
  const [pick, setPick] = useState("");

  const reset = () => {
    setName("");
    setAmount("");
    setModel("fixed_bundle_price");
    setComponents([]);
    setPick("");
  };

  const addComponent = (productId: string) => {
    if (!productId || components.some((c) => c.product_id === productId))
      return;
    const b = (bases.data ?? []).find((p) => p.product_id === productId);
    if (!b) return;
    setComponents((prev) => [
      ...prev,
      { product_id: productId, name: b.name, quantity: 1 },
    ]);
    setPick("");
  };

  const setQty = (productId: string, qty: number) =>
    setComponents((prev) =>
      prev.map((c) =>
        c.product_id === productId ? { ...c, quantity: Math.max(1, qty) } : c,
      ),
    );

  const removeComponent = (productId: string) =>
    setComponents((prev) => prev.filter((c) => c.product_id !== productId));

  const canSubmit = !!name.trim() && components.length > 0 && !create.isPending;

  const submit = () => {
    if (!name.trim() || components.length === 0) return;
    const num = amount ? Number(amount) : undefined;
    const payloadComponents: BundleComponentInput[] = components.map((c) => ({
      product_id: c.product_id,
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
    } else if (model === "pct_off") {
      // priceBundle multiplies the subtotal by discount_value, so it expects a
      // FRACTION (0.10), not a whole percent. Convert here.
      payload.discount_value = (num ?? 0) / 100;
    } else {
      payload.discount_value = num ?? 0;
    }
    create.mutate(payload, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  };

  const pickOptions = [
    { value: "", label: "Add a product…" },
    ...(bases.data ?? [])
      .filter((b) => !components.some((c) => c.product_id === b.product_id))
      .map((b) => ({
        value: b.product_id,
        label: `${b.name} · ${b.product_code}`,
      })),
  ];

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
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
        <Field label="Pricing model">
          <Select value={model} onChange={setModel} options={PRICING_MODELS} />
        </Field>
        <Field
          label={
            model === "fixed_bundle_price" ? "Bundle price" : "Discount value"
          }
          hint={model === "pct_off" ? "percent" : "NGN"}
        >
          <NumberField
            value={amount}
            onChange={setAmount}
            suffix={model === "pct_off" ? "%" : "₦"}
          />
        </Field>

        <Field label="Products in this bundle" hint="at least one">
          <Select value={pick} onChange={addComponent} options={pickOptions} />
        </Field>
        {components.length > 0 && (
          <div className="space-y-2">
            {components.map((c) => (
              <div
                key={c.product_id}
                className="flex items-center gap-2 rounded-[11px] border border-line bg-text-primary/[0.03] px-3 py-2"
              >
                <span className="flex-1 min-w-0 truncate text-[13px]">
                  {c.name}
                </span>
                <input
                  type="number"
                  min={1}
                  value={c.quantity}
                  onChange={(e) => setQty(c.product_id, Number(e.target.value))}
                  className="w-14 h-8 px-2 rounded-[8px] bg-text-primary/[0.05] border border-line text-text-primary text-[12px] text-center outline-none focus:border-accent/50"
                  aria-label="Quantity"
                />
                <button
                  onClick={() => removeComponent(c.product_id)}
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
            Pick the base products this bundle includes. A bundle needs at least
            one.
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

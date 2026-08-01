import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Boxes, Check } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Card } from "@/components/ui/primitives";
import { NumberField, Toggle, MultiSelect, Select } from "@/components/ui/controls";
import { FormSection, Field } from "@/components/ui/Form";
import { toastReport } from "@/lib/error-report";
import {
  useSizeConfig,
  useCategories,
  useCategoriesEnabled,
  useCreateBaseProducts,
  type WizardBaseItem,
} from "@/lib/catalogue";

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

interface Prices {
  ngn: string;
  usd: string;
  wholesale: string;
}
const blankPrices = (): Prices => ({ ngn: "", usd: "", wholesale: "" });

/**
 * Base-product wizard — creates a WHOLE size run at once. Step 1 captures the
 * shared basics + which sizes the product comes in (from the size config); step
 * 2 collects per-size pricing. Each ticked size becomes its own base product
 * (its stock-bearing default variant priced from that row), so a full S/M/L/XL
 * run is one submit. Everything config-backed is a dropdown — no free-typing of
 * sizes, lace or category.
 */
export function BaseProductWizard() {
  const nav = useNavigate();
  useBreadcrumbs([
    { label: "Catalogue", href: "/catalogue" },
    { label: "New base product" },
  ]);

  const cfg = useSizeConfig();
  const categoriesOn = useCategoriesEnabled();
  const categories = useCategories();
  const create = useCreateBaseProducts();

  const tiers = useMemo(
    () => (cfg.data?.tiers ?? []).filter((t) => t.is_active),
    [cfg.data],
  );
  const laceLadder = useMemo(
    () => (cfg.data?.lace_sizes ?? []).filter((l) => l.is_active),
    [cfg.data],
  );

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — shared basics
  const [name, setName] = useState("");
  const [texture, setTexture] = useState("");
  const [lace, setLace] = useState("");
  const [length, setLength] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [supportedLace, setSupportedLace] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [excludePreorder, setExcludePreorder] = useState(false);

  // Step 2 — per-size pricing, keyed by size_code
  const [priceBySize, setPriceBySize] = useState<Record<string, Prices>>({});

  const sizeOptions = tiers.map((t) => ({ value: t.size_code, label: t.label }));
  const laceOptions = laceLadder.map((l) => ({
    value: l.lace_code,
    label: `${l.label} (${l.lace_code})`,
  }));
  const chosenTiers = tiers.filter((t) => sizes.includes(t.size_code));

  const canNext = name.trim().length > 0 && sizes.length > 0;

  const goStep2 = () => {
    // Seed a price row for every chosen size, preserving anything already typed.
    setPriceBySize((prev) => {
      const next: Record<string, Prices> = {};
      for (const t of chosenTiers) next[t.size_code] = prev[t.size_code] ?? blankPrices();
      return next;
    });
    setStep(2);
  };

  const setPrice = (code: string, p: Partial<Prices>) =>
    setPriceBySize((prev) => ({
      ...prev,
      [code]: { ...(prev[code] ?? blankPrices()), ...p },
    }));

  // "Same for all" — copy the first chosen size's prices to every size.
  const applyToAll = () => {
    const first = chosenTiers[0];
    if (!first) return;
    const src = priceBySize[first.size_code] ?? blankPrices();
    setPriceBySize((prev) => {
      const next = { ...prev };
      for (const t of chosenTiers) next[t.size_code] = { ...src };
      return next;
    });
  };

  const submit = () => {
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    const products: WizardBaseItem[] = chosenTiers.map((t) => {
      const p = priceBySize[t.size_code] ?? blankPrices();
      return {
        name: `${name.trim()} - ${t.label}`,
        texture_type: texture.trim() || undefined,
        lace_type: lace.trim() || undefined,
        hair_length_inches: length ? Number(length) : undefined,
        cap_size: t.label,
        category_id: categoryId || undefined,
        lace_size_codes: supportedLace.length ? supportedLace : undefined,
        preorder_excluded: excludePreorder || undefined,
        variant: {
          variant_cap_size: t.label,
          price_storefront_ngn: num(p.ngn),
          price_storefront_usd: num(p.usd),
          price_wholesale_ngn: num(p.wholesale),
        },
      };
    });
    create.mutate(products, {
      onSuccess: () => nav("/catalogue?tab=base"),
      onError: (err) =>
        toastReport("Catalogue → New base product", "Create base products", err),
    });
  };

  return (
    <div className="max-w-[720px]">
      <div className="flex items-center gap-3 mb-4">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={() => nav("/catalogue?tab=base")}
        >
          Catalogue
        </Button>
        <div className="flex items-center gap-2 text-[12px] text-text-faint ml-auto">
          <StepDot n={1} active={step === 1} done={step > 1} label="Basics" />
          <span className="w-6 h-px bg-line" />
          <StepDot n={2} active={step === 2} done={false} label="Stock & pricing" />
        </div>
      </div>

      {step === 1 ? (
        <Card className="p-5">
          <p className="text-[12.5px] text-text-muted mb-4">
            A base product is a China-origin, stock-bearing item — one per size.
            Pick the sizes and we create the whole run in one go.
          </p>
          <FormSection title="Basics">
            <Field label="Name" hint="the family name — we add the size, e.g. “… - Large”">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Khaleesi White Straight HD13x4 Pixie Wig"
                className={inputCls}
                autoComplete="off"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Texture" hint="optional">
                <input
                  value={texture}
                  onChange={(e) => setTexture(e.target.value)}
                  placeholder="Straight"
                  className={inputCls}
                  autoComplete="off"
                />
              </Field>
              <Field label="Lace" hint="optional">
                <input
                  value={lace}
                  onChange={(e) => setLace(e.target.value)}
                  placeholder="HD Lace 13x4"
                  className={inputCls}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Length (inches)" hint="optional">
                <NumberField value={length} onChange={setLength} allowDecimal={false} suffix='"' />
              </Field>
              {categoriesOn && (
                <Field label="Category" hint="optional">
                  <Select
                    value={categoryId}
                    onChange={setCategoryId}
                    options={[
                      { value: "", label: "None" },
                      ...(categories.data ?? []).map((c) => ({
                        value: c.category_id,
                        label: c.name,
                      })),
                    ]}
                  />
                </Field>
              )}
            </div>
          </FormSection>

          <FormSection title="Sizes & lace">
            <Field
              label="Sizes"
              hint="one base product is created per size (cap size set from these)"
            >
              {sizeOptions.length === 0 ? (
                <p className="text-[12px] text-text-faint">
                  No size tiers configured yet — add them under Catalogue → Config.
                </p>
              ) : (
                <MultiSelect values={sizes} onChange={setSizes} options={sizeOptions} />
              )}
            </Field>
            <Field
              label="Supported lace"
              hint="which lace constructions styled products on this base may offer"
            >
              <MultiSelect
                values={supportedLace}
                onChange={setSupportedLace}
                options={laceOptions}
              />
            </Field>
            <div className="pt-1">
              <Toggle
                checked={excludePreorder}
                onChange={setExcludePreorder}
                label="Exclude from pre-orders (show “Sold out” when out of stock)"
              />
            </div>
          </FormSection>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              icon={<ArrowRight className="w-4 h-4" />}
              disabled={!canNext}
              onClick={goStep2}
            >
              Next · pricing
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-accent-glow" />
              <h3 className="text-[15px] font-semibold">Stock & pricing</h3>
            </div>
            {chosenTiers.length > 1 && (
              <Button size="sm" variant="ghost" onClick={applyToAll}>
                Same price for all sizes
              </Button>
            )}
          </div>
          <p className="text-[12.5px] text-text-muted mb-4">
            Each size becomes its own base “{name.trim()} - …”. Set prices per
            size (leave blank to price later). SKUs are assigned automatically.
          </p>

          <div className="space-y-3">
            {chosenTiers.map((t) => {
              const p = priceBySize[t.size_code] ?? blankPrices();
              return (
                <div
                  key={t.size_code}
                  className="p-3 rounded-[12px] bg-text-primary/[0.03] border border-line"
                >
                  <div className="text-[13px] font-semibold mb-2">
                    {name.trim()} - {t.label}
                    <span className="ml-2 text-[11px] text-text-faint">
                      cap size · {t.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <Field label="Retail (₦)">
                      <NumberField
                        value={p.ngn}
                        onChange={(v) => setPrice(t.size_code, { ngn: v })}
                        suffix="₦"
                      />
                    </Field>
                    <Field label="Retail ($)">
                      <NumberField
                        value={p.usd}
                        onChange={(v) => setPrice(t.size_code, { usd: v })}
                        suffix="$"
                        placeholder="—"
                      />
                    </Field>
                    <Field label="Wholesale (₦)">
                      <NumberField
                        value={p.wholesale}
                        onChange={(v) => setPrice(t.size_code, { wholesale: v })}
                        suffix="₦"
                        placeholder="—"
                      />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>

          {create.isError && (
            <p className="text-[12px] text-danger mt-3">
              {create.error instanceof Error
                ? create.error.message
                : "Could not create the products."}
            </p>
          )}

          <div className="flex justify-between gap-2 pt-4">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Check className="w-4 h-4" />}
              disabled={create.isPending}
              onClick={submit}
            >
              {create.isPending
                ? "Creating…"
                : `Create ${chosenTiers.length} base ${chosenTiers.length === 1 ? "product" : "products"}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function StepDot({
  n,
  active,
  done,
  label,
}: {
  n: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={
          "grid place-items-center w-5 h-5 rounded-full text-[10px] font-semibold " +
          (active
            ? "bg-accent text-white"
            : done
              ? "bg-success/20 text-success"
              : "bg-text-primary/[0.08] text-text-faint")
        }
      >
        {done ? <Check className="w-3 h-3" /> : n}
      </span>
      <span className={active ? "text-text-primary" : ""}>{label}</span>
    </span>
  );
}

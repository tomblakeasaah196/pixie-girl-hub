import { useEffect, useMemo, useState } from "react";
import {
  Truck,
  BadgeCent,
  Undo2,
  PackageX,
  ClipboardCheck,
  Warehouse,
  ChevronLeft,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, MoneyText } from "@/components/ui/primitives";
import { Select, NumberField } from "@/components/ui/controls";
import { ProductPicker } from "@/components/catalogue/ProductPicker";
import { resolvePick, type ResolvedLine } from "@/lib/product-search";
import { usePartners, usePartnerDetail, useConsignmentStock, useStockLocationsLite, useRpMutations } from "./hooks";
import { FieldLabel, TextInput, InfoBanner } from "./parts";
import { isoDay } from "./format";
import type { MovementType, MovementInput } from "./types";
import { MOVEMENT_TYPE_LABEL, num } from "./types";

/* ── Intent configuration — one guided form per business action ────── */
interface IntentCfg {
  icon: typeof Truck;
  blurb: string;
  /** Where the variant comes from: our catalogue (dispatch) or what's
   *  already at the partner location (everything else). */
  variantSource: "catalogue" | "stock";
  /** Count adjustment may add a variant that isn't in the ledger yet. */
  catalogueFallback?: boolean;
  needsWarehouse: boolean;
  price: "required" | "optional" | "hidden";
  priceLabel: string;
  priceHint?: string;
  capAtOnHand: boolean;
  saleFields: boolean;
  warnBanner?: string;
}

const INTENTS: Record<MovementType, IntentCfg> = {
  dispatch_to_partner: {
    icon: Truck,
    blurb: "Send stock from our warehouse to a partner location.",
    variantSource: "catalogue",
    needsWarehouse: true,
    price: "optional",
    priceLabel: "Agreed retail price (per unit)",
    priceHint:
      "Stored on the consignment line and used to split partner sales — set it now so reported sales never book ₦0.",
    capAtOnHand: false,
    saleFields: false,
  },
  partner_sale: {
    icon: BadgeCent,
    blurb: "The partner sold units to an end customer.",
    variantSource: "stock",
    needsWarehouse: false,
    price: "required",
    priceLabel: "Sale price (per unit)",
    capAtOnHand: true,
    saleFields: true,
  },
  partner_return: {
    icon: Undo2,
    blurb: "The partner's customer returned units (stay at the partner).",
    variantSource: "stock",
    needsWarehouse: false,
    price: "optional",
    priceLabel: "Unit value (for the settlement)",
    capAtOnHand: true,
    saleFields: false,
  },
  partner_damage: {
    icon: PackageX,
    blurb: "Units damaged or lost while at the partner.",
    variantSource: "stock",
    needsWarehouse: false,
    price: "optional",
    priceLabel: "Unit value (damage charge)",
    capAtOnHand: true,
    saleFields: false,
  },
  recall_to_warehouse: {
    icon: Warehouse,
    blurb: "Bring consignment units back into our warehouse.",
    variantSource: "stock",
    needsWarehouse: true,
    price: "hidden",
    priceLabel: "",
    capAtOnHand: true,
    saleFields: false,
  },
  partner_count_adjustment: {
    icon: ClipboardCheck,
    blurb: "A physical count found more units than the ledger shows.",
    variantSource: "stock",
    catalogueFallback: true,
    needsWarehouse: false,
    price: "optional",
    priceLabel: "Agreed retail price (per unit)",
    capAtOnHand: false,
    saleFields: false,
    warnBanner:
      "The backend only supports upward count adjustments (found units). To remove units use Damage or Recall.",
  },
};

const INTENT_ORDER: MovementType[] = [
  "dispatch_to_partner",
  "partner_sale",
  "partner_return",
  "recall_to_warehouse",
  "partner_damage",
  "partner_count_adjustment",
];

export function MovementModal({
  open,
  onClose,
  intent: presetIntent,
  presetPartnerId,
}: {
  open: boolean;
  onClose: () => void;
  /** Skip the chooser and open a specific guided form. */
  intent?: MovementType | null;
  /** Lock the partner (e.g. launched from the partner drawer). */
  presetPartnerId?: string | null;
}) {
  const [intent, setIntent] = useState<MovementType | null>(presetIntent ?? null);
  const [partnerId, setPartnerId] = useState(presetPartnerId ?? "");
  const [locationId, setLocationId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [catalogueLines, setCatalogueLines] = useState<ResolvedLine[]>([]);
  const [useCatalogue, setUseCatalogue] = useState(false);
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [saleDate, setSaleDate] = useState(isoDay());
  const [customerName, setCustomerName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");

  const { recordMovement } = useRpMutations();

  useEffect(() => {
    if (!open) return;
    setIntent(presetIntent ?? null);
    setPartnerId(presetPartnerId ?? "");
    setLocationId("");
    setVariantId("");
    setCatalogueLines([]);
    setUseCatalogue(false);
    setUnits("");
    setPrice("");
    setPriceTouched(false);
    setSaleDate(isoDay());
    setCustomerName("");
    setWarehouseId("");
    setNotes("");
    recordMovement.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetIntent, presetPartnerId]);

  const cfg = intent ? INTENTS[intent] : null;

  // ── Sources ───────────────────────────────────────────────
  const { data: partners = [] } = usePartners();
  const activePartners = useMemo(
    () => partners.filter((p) => p.status === "active"),
    [partners],
  );
  const partner = partners.find((p) => p.partner_id === partnerId) ?? null;

  const { data: partnerDetail } = usePartnerDetail(partnerId || null);
  const locations = useMemo(
    () => (partnerDetail?.locations ?? []).filter((l) => l.is_active),
    [partnerDetail],
  );

  const { data: locationStock = [] } = useConsignmentStock(
    locationId ? { consignment_location_id: locationId } : {},
  );
  const stockAtLocation = useMemo(
    () => (locationId ? locationStock : []),
    [locationId, locationStock],
  );

  const { data: stockLocations = [] } = useStockLocationsLite();
  const warehouses = useMemo(
    () =>
      stockLocations.filter(
        (l) => l.is_active && l.location_type !== "partner_consignment",
      ),
    [stockLocations],
  );

  // Auto-select single options.
  useEffect(() => {
    if (locations.length === 1) setLocationId(locations[0].consignment_location_id);
  }, [locations]);

  const fromCatalogue =
    cfg?.variantSource === "catalogue" || (cfg?.catalogueFallback && useCatalogue);

  const stockRow = useMemo(
    () =>
      stockAtLocation.find((r) => r.variant_id === variantId) ?? null,
    [stockAtLocation, variantId],
  );
  const catalogueLine =
    catalogueLines.find((l) => l.variant_id === variantId) ?? null;

  // Prefill the price from the agreed price / catalogue price until touched.
  useEffect(() => {
    if (priceTouched || !cfg || cfg.price === "hidden") return;
    if (fromCatalogue && catalogueLine && catalogueLine.unit_price > 0) {
      setPrice(String(catalogueLine.unit_price));
    } else if (!fromCatalogue && stockRow?.agreed_retail_price_ngn) {
      setPrice(String(num(stockRow.agreed_retail_price_ngn)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, fromCatalogue]);

  // ── Guards ────────────────────────────────────────────────
  const unitsNum = Number(units || "0");
  const onHand = stockRow?.qty_on_hand ?? 0;
  const overCap = !!cfg?.capAtOnHand && !fromCatalogue && unitsNum > onHand;
  const priceNum = Number(price || "0");
  const priceMissing = cfg?.price === "required" && priceNum <= 0;

  const canSubmit =
    !!cfg &&
    !!partnerId &&
    !!locationId &&
    !!variantId &&
    unitsNum > 0 &&
    Number.isInteger(unitsNum) &&
    !overCap &&
    !priceMissing &&
    (!cfg.needsWarehouse || !!warehouseId);

  const submit = () => {
    if (!cfg || !intent || !canSubmit) return;
    const input: MovementInput = {
      consignment_location_id: locationId,
      variant_id: variantId,
      movement_type: intent,
      units: unitsNum,
      ...(cfg.price !== "hidden" && priceNum > 0
        ? { unit_retail_price_ngn: priceNum }
        : {}),
      ...(cfg.saleFields && saleDate ? { reported_sale_at: saleDate } : {}),
      ...(cfg.saleFields && customerName.trim()
        ? { reported_customer_name: customerName.trim() }
        : {}),
      ...(cfg.needsWarehouse ? { warehouse_location_id: warehouseId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    recordMovement.mutate(input, { onSuccess: onClose });
  };

  // Sale split preview.
  const marginPct = num(partner?.margin_share_pct);
  const gross = priceNum * unitsNum;
  const partnerShare = (gross * marginPct) / 100;

  const stockOpts = useMemo(
    () => [
      { value: "", label: "Choose what moved…" },
      ...stockAtLocation.map((r) => ({
        value: r.variant_id,
        label: `${r.variant_name || r.sku || `${r.variant_id.slice(0, 8)}…`} · ${r.qty_on_hand} on hand`,
      })),
    ],
    [stockAtLocation],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        cfg && intent ? (
          <span className="inline-flex items-center gap-2">
            {!presetIntent && (
              <button
                onClick={() => setIntent(null)}
                aria-label="Back to actions"
                className="grid place-items-center w-7 h-7 rounded-lg text-text-muted hover:bg-text-primary/[0.07]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {MOVEMENT_TYPE_LABEL[intent]}
          </span>
        ) : (
          "Record consignment movement"
        )
      }
      size="md"
      footer={
        cfg ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!canSubmit || recordMovement.isPending}
            >
              {recordMovement.isPending ? "Recording…" : "Record movement"}
            </Button>
          </>
        ) : undefined
      }
    >
      {/* ── Step 0: choose the action ── */}
      {!cfg && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {INTENT_ORDER.map((key) => {
            const c = INTENTS[key];
            const Icon = c.icon;
            return (
              <button
                key={key}
                onClick={() => setIntent(key)}
                className="flex items-start gap-3 p-3.5 rounded-[13px] border border-line text-left hover:border-accent/40 hover:bg-accent/[0.05] transition-colors min-h-[44px]"
              >
                <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-accent/10 text-accent-glow shrink-0">
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold">
                    {MOVEMENT_TYPE_LABEL[key]}
                  </span>
                  <span className="block text-[11.5px] text-text-muted leading-snug mt-0.5">
                    {c.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Guided form ── */}
      {cfg && (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-text-muted -mt-1">{cfg.blurb}</p>
          {cfg.warnBanner && <InfoBanner tone="warn">{cfg.warnBanner}</InfoBanner>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Partner</FieldLabel>
              <Select
                value={partnerId}
                onChange={(v) => {
                  setPartnerId(v);
                  setLocationId("");
                  setVariantId("");
                }}
                disabled={!!presetPartnerId}
                options={[
                  { value: "", label: "Choose a partner…" },
                  ...activePartners.map((p) => ({
                    value: p.partner_id,
                    label: p.display_name,
                  })),
                  // Keep a preset partner selectable even if not active.
                  ...(presetPartnerId &&
                  !activePartners.some((p) => p.partner_id === presetPartnerId)
                    ? partners
                        .filter((p) => p.partner_id === presetPartnerId)
                        .map((p) => ({ value: p.partner_id, label: p.display_name }))
                    : []),
                ]}
              />
            </div>
            <div>
              <FieldLabel>Partner location</FieldLabel>
              <Select
                value={locationId}
                onChange={(v) => {
                  setLocationId(v);
                  setVariantId("");
                }}
                disabled={!partnerId}
                options={[
                  { value: "", label: partnerId ? "Choose a location…" : "Pick a partner first" },
                  ...locations.map((l) => ({
                    value: l.consignment_location_id,
                    label: l.display_name,
                  })),
                ]}
              />
              {partnerId && partnerDetail && locations.length === 0 && (
                <div className="text-[11px] text-warn mt-1">
                  This partner has no locations yet — add one from the partner's
                  profile first.
                </div>
              )}
            </div>
          </div>

          {/* Variant */}
          <div>
            <FieldLabel>
              {fromCatalogue ? "Product to send" : "Item at this location"}
            </FieldLabel>
            {fromCatalogue ? (
              catalogueLines.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <Select
                    value={variantId}
                    onChange={setVariantId}
                    options={[
                      { value: "", label: "Choose the variant…" },
                      ...catalogueLines.map((l) => ({
                        value: l.variant_id,
                        label: `${l.label} (${l.sku})`,
                      })),
                    ]}
                  />
                  <button
                    onClick={() => {
                      setCatalogueLines([]);
                      setVariantId("");
                    }}
                    className="self-start text-[12px] font-semibold text-text-muted hover:text-text-primary"
                  >
                    ← Pick a different product
                  </button>
                </div>
              ) : (
                <ProductPicker
                  onPick={async (hit) => {
                    try {
                      const resolved = await resolvePick(hit);
                      setCatalogueLines(resolved.lines);
                      if (resolved.lines.length === 1) {
                        setVariantId(resolved.lines[0].variant_id);
                      }
                    } catch {
                      setCatalogueLines([]);
                    }
                  }}
                />
              )
            ) : (
              <div className="flex flex-col gap-1.5">
                <Select
                  value={variantId}
                  onChange={setVariantId}
                  disabled={!locationId}
                  options={
                    stockOpts.length > 1
                      ? stockOpts
                      : [{ value: "", label: locationId ? "Nothing on consignment here yet" : "Pick a location first" }]
                  }
                />
                {cfg.catalogueFallback && locationId && (
                  <button
                    onClick={() => {
                      setUseCatalogue(true);
                      setVariantId("");
                    }}
                    className="self-start text-[12px] font-semibold text-accent-glow hover:brightness-110"
                  >
                    Item isn't listed here — pick from the catalogue
                  </button>
                )}
              </div>
            )}
            {cfg.catalogueFallback && useCatalogue && (
              <button
                onClick={() => {
                  setUseCatalogue(false);
                  setCatalogueLines([]);
                  setVariantId("");
                }}
                className="mt-1.5 text-[12px] font-semibold text-text-muted hover:text-text-primary"
              >
                ← Back to items at this location
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Units</FieldLabel>
              <NumberField
                value={units}
                onChange={setUnits}
                allowDecimal={false}
                placeholder="0"
              />
              {cfg.capAtOnHand && !fromCatalogue && stockRow && (
                <div
                  className={
                    overCap
                      ? "text-[11px] text-danger mt-1"
                      : "text-[11px] text-text-faint mt-1"
                  }
                >
                  {overCap
                    ? `Only ${onHand} on hand at this location.`
                    : `${onHand} on hand at this location.`}
                </div>
              )}
            </div>
            {cfg.price !== "hidden" && (
              <div>
                <FieldLabel>
                  {cfg.priceLabel}
                  {cfg.price === "required" ? " *" : ""}
                </FieldLabel>
                <NumberField
                  value={price}
                  onChange={(v) => {
                    setPrice(v);
                    setPriceTouched(true);
                  }}
                  allowDecimal
                  placeholder="0.00"
                  suffix="NGN"
                />
                {priceMissing && units && (
                  <div className="text-[11px] text-danger mt-1">
                    A sale needs a unit price — otherwise it books ₦0.
                  </div>
                )}
                {cfg.priceHint && (
                  <div className="text-[11px] text-text-faint mt-1 leading-snug">
                    {cfg.priceHint}
                  </div>
                )}
              </div>
            )}
          </div>

          {cfg.saleFields && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Sold on</FieldLabel>
                <TextInput value={saleDate} onChange={setSaleDate} type="date" />
              </div>
              <div>
                <FieldLabel>Customer name (optional)</FieldLabel>
                <TextInput
                  value={customerName}
                  onChange={setCustomerName}
                  placeholder="As reported by the partner"
                />
              </div>
            </div>
          )}

          {cfg.needsWarehouse && (
            <div>
              <FieldLabel>
                {intent === "dispatch_to_partner"
                  ? "Dispatch from warehouse *"
                  : "Return to warehouse *"}
              </FieldLabel>
              <Select
                value={warehouseId}
                onChange={setWarehouseId}
                options={[
                  { value: "", label: "Choose a warehouse…" },
                  ...warehouses.map((w) => ({
                    value: w.location_id,
                    label: w.display_name,
                  })),
                ]}
              />
              <div className="text-[11px] text-text-faint mt-1">
                Our stock books move together with the consignment ledger.
              </div>
            </div>
          )}

          {/* Sale split preview */}
          {cfg.saleFields && gross > 0 && partner && (
            <div className="p-3 rounded-[11px] border border-line bg-text-primary/[0.02] grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                  Gross
                </div>
                <MoneyText ngn={gross} className="text-[15px]" />
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                  Partner ({marginPct}%)
                </div>
                <MoneyText ngn={partnerShare} className="text-[15px]" />
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                  Our share
                </div>
                <MoneyText ngn={gross - partnerShare} className="text-[15px]" />
              </div>
            </div>
          )}

          <div>
            <FieldLabel>Notes (optional)</FieldLabel>
            <TextInput
              value={notes}
              onChange={setNotes}
              placeholder="Reference or context for the ledger"
            />
          </div>

          {recordMovement.isError && (
            <InfoBanner tone="warn">
              {(recordMovement.error as Error)?.message ||
                "Could not record the movement."}
            </InfoBanner>
          )}
        </div>
      )}
    </Modal>
  );
}

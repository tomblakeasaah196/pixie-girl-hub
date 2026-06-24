/**
 * Shipping Rates tab — full-page zone management with:
 *   • Rate-card quote calculator (country_code + qty → tier breakdown)
 *   • Zone list with courier filter, search, active toggle
 *   • Excel import / template download
 *   • Zone edit drawer with inline rate-card tier rows
 */

import { useRef, useState } from "react";
import {
  Download,
  Upload,
  Plus,
  Search,
  Check,
  Loader2,
  Trash2,
  Globe,
  MapPin,
  Calculator,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { money } from "@/lib/format";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useZones,
  useCreateZone,
  useUpdateZone,
  useDeleteZone,
  useRateCardQuote,
  useImportRates,
  downloadRatesTemplate,
  type DeliveryZone,
  type RateTier,
  type RateCard,
  type ZoneGeometryType,
  type ZoneGeometry,
} from "@/lib/logistics-api";

// ── Nigeria states (ISO-3166-2:NG codes) ───────────────────

const NG_STATES: { value: string; label: string }[] = [
  { value: "NG-AB", label: "Abia" },
  { value: "NG-AD", label: "Adamawa" },
  { value: "NG-AK", label: "Akwa Ibom" },
  { value: "NG-AN", label: "Anambra" },
  { value: "NG-BA", label: "Bauchi" },
  { value: "NG-BY", label: "Bayelsa" },
  { value: "NG-BE", label: "Benue" },
  { value: "NG-BO", label: "Borno" },
  { value: "NG-CR", label: "Cross River" },
  { value: "NG-DE", label: "Delta" },
  { value: "NG-EB", label: "Ebonyi" },
  { value: "NG-ED", label: "Edo" },
  { value: "NG-EK", label: "Ekiti" },
  { value: "NG-EN", label: "Enugu" },
  { value: "NG-GO", label: "Gombe" },
  { value: "NG-IM", label: "Imo" },
  { value: "NG-JI", label: "Jigawa" },
  { value: "NG-KD", label: "Kaduna" },
  { value: "NG-KN", label: "Kano" },
  { value: "NG-KT", label: "Katsina" },
  { value: "NG-KE", label: "Kebbi" },
  { value: "NG-KO", label: "Kogi" },
  { value: "NG-KW", label: "Kwara" },
  { value: "NG-LA", label: "Lagos" },
  { value: "NG-NA", label: "Nasarawa" },
  { value: "NG-NI", label: "Niger" },
  { value: "NG-OG", label: "Ogun" },
  { value: "NG-ON", label: "Ondo" },
  { value: "NG-OS", label: "Osun" },
  { value: "NG-OY", label: "Oyo" },
  { value: "NG-PL", label: "Plateau" },
  { value: "NG-RI", label: "Rivers" },
  { value: "NG-SO", label: "Sokoto" },
  { value: "NG-TA", label: "Taraba" },
  { value: "NG-YO", label: "Yobe" },
  { value: "NG-ZA", label: "Zamfara" },
  { value: "NG-FC", label: "FCT (Abuja)" },
];

// Lagos LGAs (sub-codes used in the seeded zones)
const LAGOS_LGAS: { value: string; label: string }[] = [
  { value: "NG-LA-AGE", label: "Agege" },
  { value: "NG-LA-AGO", label: "Ajeromi-Ifelodun" },
  { value: "NG-LA-ALA", label: "Alimosho" },
  { value: "NG-LA-AML", label: "Amuwo-Odofin" },
  { value: "NG-LA-APR", label: "Apapa" },
  { value: "NG-LA-BAD", label: "Badagry" },
  { value: "NG-LA-EPE", label: "Epe" },
  { value: "NG-LA-ETI", label: "Eti-Osa" },
  { value: "NG-LA-IJE", label: "Ibeju-Lekki" },
  { value: "NG-LA-IFE", label: "Ifako-Ijaiye" },
  { value: "NG-LA-IKJ", label: "Ikeja" },
  { value: "NG-LA-IKO", label: "Ikorodu" },
  { value: "NG-LA-ILA", label: "Isale-Eko / Lagos Island" },
  { value: "NG-LA-ILO", label: "Lagos Mainland" },
  { value: "NG-LA-MUS", label: "Mushin" },
  { value: "NG-LA-OJO", label: "Ojo" },
  { value: "NG-LA-OSO", label: "Oshodi-Isolo" },
  { value: "NG-LA-SOM", label: "Somolu" },
  { value: "NG-LA-SUR", label: "Surulere" },
  { value: "NG-LA-LEK", label: "Lekki / Ikoyi (island)" },
];

const INTERNATIONAL: { value: string; label: string }[] = [
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "TZ", label: "Tanzania" },
  { value: "ZA", label: "South Africa" },
  { value: "LR", label: "Liberia" },
  { value: "CI", label: "Côte d'Ivoire" },
  { value: "SN", label: "Senegal" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "AE", label: "UAE" },
  { value: "IE", label: "Ireland" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
  { value: "IT", label: "Italy" },
  { value: "NL", label: "Netherlands" },
  { value: "AU", label: "Australia" },
  { value: "SA", label: "Saudi Arabia" },
];

const ALL_COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "NG", label: "Nigeria (whole country)" },
  ...LAGOS_LGAS,
  ...NG_STATES.filter((s) => s.value !== "NG-LA"),
  ...INTERNATIONAL,
];

type RatesSubTab = "all" | "lagos" | "states" | "international";

// ── Main tab ────────────────────────────────────────────────

export function ShippingRatesTab() {
  const { can } = useAuthStore();
  const zonesQ = useZones();
  const delZone = useDeleteZone();
  const importRates = useImportRates();
  const fileRef = useRef<HTMLInputElement>(null);

  const [subTab, setSubTab] = useState<RatesSubTab>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DeliveryZone | "new" | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const zones = zonesQ.data ?? [];

  const filtered = zones.filter((z) => {
    if (search) {
      const q = search.toLowerCase();
      if (!z.name.toLowerCase().includes(q) && !z.country_code?.toLowerCase().includes(q)) return false;
    }
    if (subTab === "lagos") return z.country_code?.startsWith("NG-LA");
    if (subTab === "states") return z.country_code?.startsWith("NG-") && !z.country_code?.startsWith("NG-LA");
    if (subTab === "international") return z.country_code && !z.country_code.startsWith("NG");
    return true;
  });

  const counts = {
    all: zones.length,
    lagos: zones.filter((z) => z.country_code?.startsWith("NG-LA")).length,
    states: zones.filter((z) => z.country_code?.startsWith("NG-") && !z.country_code?.startsWith("NG-LA")).length,
    international: zones.filter((z) => z.country_code && !z.country_code.startsWith("NG")).length,
  };

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadRatesTemplate();
    } finally {
      setDownloading(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);
    importRates.mutate(file, {
      onSuccess: (r) => {
        const result = (r as { data?: typeof r } & typeof r)?.data ?? r;
        setImportSuccess(
          `Import complete: ${result.created ?? 0} created, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped.`,
        );
      },
      onError: () => setImportError("Import failed. Check the file format and try again."),
    });
    e.target.value = "";
  }

  const SUB_TABS: { key: RatesSubTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "lagos", label: "Lagos LGAs" },
    { key: "states", label: "Nigerian States" },
    { key: "international", label: "International" },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center flex-1 min-w-[200px] max-w-sm rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50 px-3">
          <Search className="w-4 h-4 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search zones…"
            className="w-full bg-transparent px-2 h-[42px] text-[13px] outline-none"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            icon={<Calculator className="w-4 h-4" />}
            onClick={() => setQuoteOpen(true)}
          >
            Rate calculator
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            onClick={handleDownload}
            disabled={downloading}
          >
            Download template
          </Button>
          {can("logistics", "edit") && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={importRates.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                onClick={() => fileRef.current?.click()}
                disabled={importRates.isPending}
              >
                Import Excel
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={handleFileSelected}
              />
            </>
          )}
          {can("logistics", "create") && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setEditing("new")}
            >
              New zone
            </Button>
          )}
        </div>
      </div>

      {/* Import feedback */}
      {importSuccess && (
        <div className="rounded-[11px] bg-success/10 border border-success/30 px-3.5 py-2.5 text-[12.5px] text-success flex items-center gap-2">
          <Check className="w-4 h-4" /> {importSuccess}
        </div>
      )}
      {importError && (
        <div className="rounded-[11px] bg-danger/10 border border-danger/30 px-3.5 py-2.5 text-[12.5px] text-danger">
          {importError}
        </div>
      )}

      {/* Sub-tabs */}
      <nav className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              subTab === t.key
                ? "border-accent text-accent-glow"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
            <span className="text-[10.5px] rounded-full bg-accent/[0.08] text-text-faint px-1.5 py-px">
              {counts[t.key]}
            </span>
          </button>
        ))}
      </nav>

      {/* Zone list */}
      {zonesQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} style={{ height: 52 }} />)}
        </Card>
      ) : zonesQ.isError ? (
        <ErrorState onRetry={() => zonesQ.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Globe className="w-7 h-7" />}
          title="No zones"
          message={search ? "No zones match your search." : "No zones configured in this category."}
          action={
            can("logistics", "create") && !search ? (
              <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
                New zone
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {/* Header row */}
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 border-b border-line text-[10.5px] uppercase tracking-widest text-text-faint">
            <span>Zone / country</span>
            <span className="text-right">Tiers</span>
            <span className="text-right">Base fee</span>
            <span className="text-right">Status</span>
            <span />
          </div>
          {filtered.map((z, i) => (
            <ZoneRow
              key={z.zone_id}
              zone={z}
              last={i === filtered.length - 1}
              onEdit={() => setEditing(z)}
              onDelete={() => {
                if (window.confirm(`Delete zone "${z.name}"?`)) delZone.mutate(z.zone_id);
              }}
              canEdit={can("logistics", "edit")}
              canDelete={can("logistics", "delete")}
            />
          ))}
        </Card>
      )}

      {editing && (
        <ZoneEditorDrawer
          zone={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {quoteOpen && <RateQuoteDrawer onClose={() => setQuoteOpen(false)} />}
    </div>
  );
}

// ── Zone row ────────────────────────────────────────────────

function ZoneRow({
  zone,
  last,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  zone: DeliveryZone;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const tierCount = zone.rate_card?.tiers?.length ?? 0;
  const icon = zone.geometry_type === "country" ? Globe : MapPin;
  const Icon = icon;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 hover:bg-text-primary/[0.02] transition-colors ${!last ? "border-b border-line" : ""}`}
    >
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <button className="flex-1 min-w-0 text-left" onClick={onEdit}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13.5px] font-medium truncate">{zone.name}</span>
          {zone.courier_key && (
            <span className="text-[10.5px] font-mono text-text-faint bg-panel-2 border border-line px-1.5 py-0.5 rounded">
              {zone.courier_key}
            </span>
          )}
        </div>
        {zone.country_code && (
          <div className="text-[11.5px] text-text-faint mt-0.5 font-mono">{zone.country_code}</div>
        )}
      </button>

      <div className="hidden md:block text-right shrink-0">
        {tierCount > 0 ? (
          <span className="text-[11.5px] text-text-muted">{tierCount} tier{tierCount !== 1 ? "s" : ""}</span>
        ) : (
          <span className="text-[11.5px] text-text-faint">flat</span>
        )}
      </div>
      <div className="hidden md:block text-right shrink-0">
        <span className="font-mono text-[12.5px]">{money(zone.fee_ngn)}</span>
      </div>
      <div className="hidden md:block shrink-0">
        <Pill tone={zone.is_active ? "success" : "neutral"} dot={false}>
          {zone.is_active ? "Active" : "Off"}
        </Pill>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {canEdit && (
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-text-faint hover:text-accent-glow hover:bg-panel-2 border border-transparent hover:border-line transition-colors"
            title="Edit zone"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-text-faint hover:text-danger hover:bg-panel-2 border border-transparent hover:border-line transition-colors"
            title="Delete zone"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Rate quote calculator drawer ─────────────────────────────

function RateQuoteDrawer({ onClose }: { onClose: () => void }) {
  const quote = useRateCardQuote();
  const [countryCode, setCountryCode] = useState("");
  const [qty, setQty] = useState("1");

  const result = quote.data as (typeof quote.data & { data?: typeof quote.data }) | undefined;
  const quoteData = (result as { data?: typeof result })?.data ?? result;

  function run() {
    if (!countryCode) return;
    quote.mutate({ country_code: countryCode, qty: Math.max(1, parseInt(qty) || 1) });
  }

  return (
    <Drawer open onClose={onClose} title="Rate calculator" subtitle="Look up shipping fee by destination + quantity">
      <div className="space-y-5 p-1">
        <Field label="Destination">
          <Select
            value={countryCode}
            onChange={setCountryCode}
            options={[{ value: "", label: "Choose destination…" }, ...ALL_COUNTRY_OPTIONS]}
          />
        </Field>

        <Field label="Number of items">
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] font-mono outline-none focus:border-accent/50"
          />
        </Field>

        <Button
          variant="primary"
          disabled={!countryCode || quote.isPending}
          onClick={run}
          icon={quote.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
        >
          Calculate fee
        </Button>

        {quoteData && (
          <div className="rounded-xl border border-line overflow-hidden">
            {quoteData.zone_id ? (
              <>
                <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold">{quoteData.zone_name}</div>
                    {quoteData.courier_key && (
                      <div className="text-[11.5px] text-text-faint font-mono mt-0.5">{quoteData.courier_key}</div>
                    )}
                  </div>
                  <div className="font-display text-[26px] tabular-nums text-accent-glow">
                    {money(quoteData.fee_ngn ?? 0)}
                  </div>
                </div>

                {quoteData.rate_card?.tiers && quoteData.rate_card.tiers.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="text-[10.5px] uppercase tracking-widest text-text-faint mb-2.5">All tiers</div>
                    <div className="space-y-1.5">
                      {quoteData.rate_card.tiers.map((tier, i) => {
                        const n = Math.max(1, parseInt(qty) || 1);
                        const isActive = n >= tier.min_qty && (tier.max_qty == null || n <= tier.max_qty);
                        return (
                          <div
                            key={i}
                            className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12.5px] transition-colors ${
                              isActive
                                ? "bg-accent/[0.10] border border-accent/30 text-accent-glow"
                                : "bg-text-primary/[0.03] text-text-muted"
                            }`}
                          >
                            <span className="font-medium">{tier.label}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] text-text-faint">
                                {tier.min_qty}–{tier.max_qty ?? "∞"} items
                              </span>
                              <span className="font-mono tabular-nums">{money(tier.fee_ngn)}</span>
                              {isActive && <Check className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {quoteData.rate_card.add_on_per_2_ngn && (
                      <div className="mt-2 text-[11.5px] text-text-faint">
                        Beyond last tier: +{money(quoteData.rate_card.add_on_per_2_ngn)} per 2 additional items
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="px-4 py-4 text-[12.5px] text-text-faint italic">
                No zone covers this destination. A flat international rate may apply.
              </div>
            )}
          </div>
        )}

        {quote.isError && (
          <p className="text-[12px] text-danger">Could not retrieve rate. Check the destination code.</p>
        )}
      </div>
    </Drawer>
  );
}

// ── Zone editor drawer ───────────────────────────────────────

function ZoneEditorDrawer({ zone, onClose }: { zone: DeliveryZone | null; onClose: () => void }) {
  const create = useCreateZone();
  const update = useUpdateZone();
  const isNew = !zone;

  const [name, setName] = useState(zone?.name ?? "");
  const [type, setType] = useState<ZoneGeometryType>(zone?.geometry_type ?? "country");
  const [fee, setFee] = useState(String(zone?.fee_ngn ?? ""));
  const [priority, setPriority] = useState(String(zone?.priority ?? 0));
  const [active, setActive] = useState(zone?.is_active ?? true);
  const [country, setCountry] = useState(zone?.country_code ?? "");
  const [courierKey, setCourierKey] = useState(zone?.courier_key ?? "");
  // radius/polygon geometry
  const [centerLat, setCenterLat] = useState(String(zone?.geometry.center?.[1] ?? ""));
  const [centerLng, setCenterLng] = useState(String(zone?.geometry.center?.[0] ?? ""));
  const [radiusKm, setRadiusKm] = useState(String(zone?.geometry.radius_km ?? ""));
  const [pointsText, setPointsText] = useState(
    (zone?.geometry.points ?? []).map((p) => `${p[0]}, ${p[1]}`).join("\n"),
  );
  // Rate card tiers
  const [tiers, setTiers] = useState<{ label: string; min_qty: string; max_qty: string; fee_ngn: string }[]>(
    () =>
      zone?.rate_card?.tiers?.map((t) => ({
        label: t.label,
        min_qty: String(t.min_qty),
        max_qty: t.max_qty == null ? "" : String(t.max_qty),
        fee_ngn: String(t.fee_ngn),
      })) ?? [],
  );
  const [addOnPer2, setAddOnPer2] = useState(String(zone?.rate_card?.add_on_per_2_ngn ?? ""));

  const busy = create.isPending || update.isPending;

  function buildGeometry(): ZoneGeometry | null {
    if (type === "country") return {};
    if (type === "radius") {
      const la = Number(centerLat);
      const ln = Number(centerLng);
      const r = Number(radiusKm);
      if (!Number.isFinite(la) || !Number.isFinite(ln) || !(r > 0)) return null;
      return { center: [ln, la], radius_km: r };
    }
    const pts = pointsText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [a, b] = l.split(/[,\s]+/).map(Number);
        return [a, b] as [number, number];
      })
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (pts.length < 3) return null;
    return { points: pts };
  }

  function buildRateCard(): RateCard | undefined {
    const validTiers: RateTier[] = tiers
      .filter((t) => t.label && t.min_qty && t.fee_ngn)
      .map((t) => ({
        label: t.label,
        min_qty: parseInt(t.min_qty) || 1,
        max_qty: t.max_qty ? parseInt(t.max_qty) : null,
        fee_ngn: parseFloat(t.fee_ngn) || 0,
      }));
    if (!validTiers.length && !addOnPer2) return undefined;
    return {
      tiers: validTiers,
      add_on_per_2_ngn: addOnPer2 ? parseFloat(addOnPer2) : undefined,
    };
  }

  function addTier() {
    const last = tiers[tiers.length - 1];
    const nextMin = last?.max_qty ? String(parseInt(last.max_qty) + 1) : "1";
    setTiers((t) => [...t, { label: "", min_qty: nextMin, max_qty: "", fee_ngn: "" }]);
  }

  function removeTier(i: number) {
    setTiers((t) => t.filter((_, j) => j !== i));
  }

  function updateTier(i: number, field: string, value: string) {
    setTiers((t) => t.map((row, j) => (j === i ? { ...row, [field]: value } : row)));
  }

  const geometryValid = buildGeometry() != null;
  const canSave =
    !!name &&
    !!fee &&
    (type === "country" ? !!country : geometryValid) &&
    !busy;

  function submit() {
    const geometry = buildGeometry();
    if (!geometry) return;
    const rateCard = buildRateCard();
    const body = {
      name,
      geometry_type: type,
      geometry,
      fee_ngn: parseFloat(fee) || 0,
      country_code: country || undefined,
      priority: parseInt(priority) || 0,
      is_active: active,
      courier_key: courierKey || undefined,
      rate_card: rateCard,
    };
    if (isNew) create.mutate(body, { onSuccess: onClose });
    else update.mutate({ id: zone!.zone_id, patch: body }, { onSuccess: onClose });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? "New zone" : "Edit zone"}
      subtitle="Delivery fee zone"
    >
      <div className="space-y-5 p-1">
        {/* Basic info */}
        <Field label="Zone name">
          <ZInput value={name} onChange={setName} placeholder="Lagos Mainland" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Base fee (₦)">
            <ZInput value={fee} onChange={(v) => setFee(v.replace(/[^0-9.]/g, ""))} placeholder="3500" mono />
          </Field>
          <Field label="Priority">
            <ZInput value={priority} onChange={(v) => setPriority(v.replace(/[^0-9]/g, ""))} placeholder="0" mono />
          </Field>
        </div>

        <Field label="Coverage type">
          <Select
            value={type}
            onChange={(v) => setType(v as ZoneGeometryType)}
            options={[
              { value: "country", label: "Country / state / LGA code" },
              { value: "radius", label: "Local — centre + radius" },
              { value: "polygon", label: "Local — polygon" },
            ]}
          />
        </Field>

        {type === "country" ? (
          <Field label="Destination">
            <Select
              value={country}
              onChange={setCountry}
              options={[{ value: "", label: "Choose destination…" }, ...ALL_COUNTRY_OPTIONS]}
            />
          </Field>
        ) : (
          <>
            {type === "radius" ? (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Centre lat">
                  <ZInput value={centerLat} onChange={(v) => setCenterLat(v.replace(/[^0-9.\-]/g, ""))} placeholder="6.45" mono />
                </Field>
                <Field label="Centre lng">
                  <ZInput value={centerLng} onChange={(v) => setCenterLng(v.replace(/[^0-9.\-]/g, ""))} placeholder="3.47" mono />
                </Field>
                <Field label="Radius km">
                  <ZInput value={radiusKm} onChange={(v) => setRadiusKm(v.replace(/[^0-9.]/g, ""))} placeholder="5" mono />
                </Field>
              </div>
            ) : (
              <Field label='Points — "lng, lat" per line (min 3)'>
                <textarea
                  value={pointsText}
                  onChange={(e) => setPointsText(e.target.value)}
                  rows={4}
                  placeholder={"3.41, 6.43\n3.49, 6.43\n3.49, 6.47"}
                  className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[12px] font-mono outline-none focus:border-accent/50 resize-y"
                />
              </Field>
            )}
          </>
        )}

        <Field label="Courier key (optional)">
          <ZInput
            value={courierKey}
            onChange={setCourierKey}
            placeholder="safe_logistics / dhl / nationwide"
            mono
          />
        </Field>

        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent" />
          Active
        </label>

        {/* Rate card tiers */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11.5px] text-text-muted">Rate card tiers</span>
            <span className="text-[10.5px] text-text-faint">Leave empty to use flat base fee</span>
          </div>

          {tiers.length > 0 && (
            <div className="space-y-2 mb-2">
              {/* Tier header */}
              <div className="grid grid-cols-[1fr_80px_80px_100px_32px] gap-2 px-1">
                {["Label", "Min qty", "Max qty", "Fee (₦)", ""].map((h) => (
                  <span key={h} className="text-[10px] uppercase tracking-widest text-text-faint">{h}</span>
                ))}
              </div>
              {tiers.map((tier, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_80px_100px_32px] gap-2 items-center">
                  <ZInput
                    value={tier.label}
                    onChange={(v) => updateTier(i, "label", v)}
                    placeholder={`Tier ${i + 1}`}
                  />
                  <ZInput
                    value={tier.min_qty}
                    onChange={(v) => updateTier(i, "min_qty", v.replace(/[^0-9]/g, ""))}
                    placeholder="1"
                    mono
                  />
                  <ZInput
                    value={tier.max_qty}
                    onChange={(v) => updateTier(i, "max_qty", v.replace(/[^0-9]/g, ""))}
                    placeholder="∞"
                    mono
                  />
                  <ZInput
                    value={tier.fee_ngn}
                    onChange={(v) => updateTier(i, "fee_ngn", v.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    mono
                  />
                  <button
                    type="button"
                    onClick={() => removeTier(i)}
                    className="p-1.5 text-text-faint hover:text-danger transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addTier}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2 text-[12px] text-text-muted hover:text-accent-glow hover:border-accent/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add tier
          </button>

          {tiers.length > 0 && (
            <div className="mt-3">
              <Field label="Add-on per 2 items beyond last tier (₦)">
                <ZInput
                  value={addOnPer2}
                  onChange={(v) => setAddOnPer2(v.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  mono
                />
              </Field>
            </div>
          )}
        </div>

        {/* Validation hints */}
        {type === "country" && !country && (name || fee) && (
          <p className="text-[11.5px] text-warn">Pick a destination for this zone.</p>
        )}
        {type !== "country" && !geometryValid && (name || fee) && (
          <p className="text-[11.5px] text-warn">
            {type === "radius"
              ? "Enter a valid centre (lat/lng) and a positive radius."
              : 'Enter at least 3 valid "lng, lat" points.'}
          </p>
        )}
        {(create.isError || update.isError) && (
          <p className="text-[12px] text-danger">Could not save the zone. Check all fields and try again.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={submit}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          >
            {isNew ? "Create zone" : "Save changes"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Shared primitives ────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function ZInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`}
    />
  );
}

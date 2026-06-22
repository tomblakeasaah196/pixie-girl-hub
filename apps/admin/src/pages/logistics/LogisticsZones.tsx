import { useCallback, useEffect, useState } from "react";
import {
  MapPin,
  Plus,
  Trash2,
  Loader2,
  Check,
  Crosshair,
  Layers,
  Globe,
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
import { Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useZones,
  useCreateZone,
  useUpdateZone,
  useDeleteZone,
  useZoneQuote,
  type DeliveryZone,
  type ZoneGeometry,
  type ZoneGeometryType,
} from "@/lib/logistics-api";
import { isGoogleMapsConfigured } from "@/lib/google-maps-loader";
import {
  GooglePlacesAutocomplete,
  type PlaceFields,
} from "@/components/common/GooglePlacesAutocomplete";
import { ZoneMap } from "./ZoneMap";

/**
 * Delivery Zones manager — geofenced areas, each carrying the delivery fee for
 * anyone whose coordinates fall inside. A zone is a polygon (a list of
 * [lng,lat] points) or a centre + radius. Overlaps resolve by priority.
 *
 * (Coordinate entry now; a Google-Maps draw tool layers on once the Maps key
 * is configured — the data model is identical.)
 */

export function ZonesManagerDrawer({ onClose }: { onClose: () => void }) {
  const { can } = useAuthStore();
  const zonesQ = useZones();
  const del = useDeleteZone();
  const [editing, setEditing] = useState<DeliveryZone | "new" | null>(null);
  const [testing, setTesting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const zones = zonesQ.data ?? [];

  return (
    <Drawer open onClose={onClose} title="Delivery zones" subtitle="Geofenced delivery fees">
      <div className="space-y-4 p-1">
        <div className="flex items-center gap-2 flex-wrap">
          {can("logistics", "create") && (
            <Button size="sm" variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
              New zone
            </Button>
          )}
          {can("logistics", "create") && (
            <Button size="sm" variant="secondary" icon={<Globe className="w-4 h-4" />} onClick={() => setBulk(true)}>
              Shipping rates
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<Crosshair className="w-4 h-4" />} onClick={() => setTesting(true)}>
            Test a point
          </Button>
        </div>

        {zonesQ.isLoading ? (
          <Card className="p-4 space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 44 }} />)}
          </Card>
        ) : zones.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-7 h-7" />}
            title="No zones yet"
            message="Create a zone to charge a delivery fee for an area."
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            {zones.map((z, i) => (
              <div key={z.zone_id} className={`p-3.5 flex items-center gap-3 ${i < zones.length - 1 ? "border-b border-line" : ""}`}>
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                  <MapPin className="w-4 h-4" />
                </span>
                <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(z)}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[13.5px] truncate">{z.name}</span>
                    {!z.is_active && <Pill tone="neutral" dot={false}>Off</Pill>}
                  </div>
                  <div className="text-[11.5px] text-text-faint">
                    {z.geometry_type === "country"
                      ? `Country: ${z.country_code ?? "—"}`
                      : z.geometry_type === "polygon"
                        ? `${z.geometry.points?.length ?? 0}-point polygon`
                        : `${z.geometry.radius_km ?? 0} km radius`}
                    {" · "}priority {z.priority}
                  </div>
                </button>
                <span className="font-mono text-[12px]">{money(z.fee_ngn)}</span>
                {can("logistics", "delete") && (
                  <button
                    onClick={() => window.confirm(`Delete zone "${z.name}"?`) && del.mutate(z.zone_id)}
                    className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
                  </button>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>

      {editing && (
        <ZoneEditor
          zone={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {testing && <PointTester onClose={() => setTesting(false)} />}
      {bulk && <BulkRatesDrawer onClose={() => setBulk(false)} />}
    </Drawer>
  );
}

// ── Bulk shipping rates (country zones in one go) ───────────

function BulkRatesDrawer({ onClose }: { onClose: () => void }) {
  const create = useCreateZone();
  const update = useUpdateZone();
  const existing = useZones();
  // Existing country zone per country_code → so a re-save updates, not dupes.
  const existingMap = new Map(
    (existing.data ?? [])
      .filter((z) => z.geometry_type === "country" && z.country_code)
      .map((z) => [z.country_code as string, z]),
  );
  // Prefill the international destinations (skip NG — that's local delivery).
  const [rows, setRows] = useState<{ country: string; fee: string }[]>(() =>
    COUNTRY_OPTIONS.filter((c) => c.value !== "NG").map((c) => ({
      country: c.value,
      fee: existingMap.get(c.value) ? String(existingMap.get(c.value)!.fee_ngn) : "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const labelFor = (code: string) =>
    COUNTRY_OPTIONS.find((c) => c.value === code)?.label ?? code;

  const filled = rows.filter((r) => r.country && Number(r.fee) > 0);

  async function save() {
    setSaving(true);
    setError(false);
    let n = 0;
    try {
      for (const r of filled) {
        const found = existingMap.get(r.country);
        if (found) {
          await update.mutateAsync({
            id: found.zone_id,
            patch: { fee_ngn: Number(r.fee), is_active: true },
          });
        } else {
          await create.mutateAsync({
            name: labelFor(r.country),
            geometry_type: "country",
            geometry: {},
            country_code: r.country,
            fee_ngn: Number(r.fee),
            priority: 0,
            is_active: true,
          });
        }
        n += 1;
      }
      setDone(n);
      setTimeout(onClose, 600);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title="Shipping rates" subtitle="Per-country flat delivery fees">
      <div className="space-y-3 p-1">
        <p className="text-[12px] text-text-muted">
          Set a flat NGN fee per country. Saving creates a country zone for each
          row with a fee, or updates the existing one — so you can re-open this
          and adjust rates any time.
        </p>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={r.country}
                  onChange={(v) => setRows((arr) => arr.map((x, j) => (j === i ? { ...x, country: v } : x)))}
                  options={[{ value: "", label: "Country…" }, ...COUNTRY_OPTIONS]}
                />
              </div>
              <div className="w-32">
                <Input
                  value={r.fee}
                  onChange={(v) => setRows((arr) => arr.map((x, j) => (j === i ? { ...x, fee: v.replace(/[^0-9.]/g, "") } : x)))}
                  placeholder="₦ fee"
                  mono
                />
              </div>
              <button
                onClick={() => setRows((arr) => arr.filter((_, j) => j !== i))}
                className="p-2 text-text-faint hover:text-danger"
                aria-label="Remove row"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setRows((arr) => [...arr, { country: "", fee: "" }])}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2 text-[12px] text-text-muted hover:text-accent-glow hover:border-accent/40"
        >
          <Plus className="w-3.5 h-3.5" /> Add country
        </button>

        {done != null && (
          <p className="text-[12px] text-success">Created {done} country zone(s).</p>
        )}
        {error && <p className="text-[12px] text-danger">Some rows couldn&rsquo;t be saved.</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={filled.length === 0 || saving}
            onClick={save}
            icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          >
            Save {filled.length || ""} rate{filled.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// Common shipping destinations (ISO-2). Extend as needed.
const COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "NG", label: "Nigeria" },
  { value: "GH", label: "Ghana" },
  { value: "KE", label: "Kenya" },
  { value: "TZ", label: "Tanzania" },
  { value: "LR", label: "Liberia" },
  { value: "ZA", label: "South Africa" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "IE", label: "Ireland" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
];

function parsePoints(text: string): [number, number][] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [a, b] = l.split(/[,\s]+/).map((n) => Number(n));
      return [a, b] as [number, number];
    })
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

function ZoneEditor({ zone, onClose }: { zone: DeliveryZone | null; onClose: () => void }) {
  const create = useCreateZone();
  const update = useUpdateZone();
  const isNew = !zone;

  const [name, setName] = useState(zone?.name ?? "");
  const [type, setType] = useState<ZoneGeometryType>(zone?.geometry_type ?? "radius");
  const [fee, setFee] = useState(String(zone?.fee_ngn ?? ""));
  const [priority, setPriority] = useState(String(zone?.priority ?? 0));
  const [active, setActive] = useState(zone?.is_active ?? true);
  const [country, setCountry] = useState(zone?.country_code ?? "");
  // radius
  const [centerLat, setCenterLat] = useState(String(zone?.geometry.center?.[1] ?? ""));
  const [centerLng, setCenterLng] = useState(String(zone?.geometry.center?.[0] ?? ""));
  const [radiusKm, setRadiusKm] = useState(String(zone?.geometry.radius_km ?? ""));
  // polygon
  const [pointsText, setPointsText] = useState(
    (zone?.geometry.points ?? []).map((p) => `${p[0]}, ${p[1]}`).join("\n"),
  );

  const busy = create.isPending || update.isPending;

  const [mapsReady, setMapsReady] = useState(false);

  useEffect(() => {
    isGoogleMapsConfigured().then((ok) => setMapsReady(ok));
  }, []);

  function buildGeometry(): ZoneGeometry | null {
    if (type === "country") return {}; // matched by country, no geometry
    if (type === "radius") {
      const la = Number(centerLat);
      const ln = Number(centerLng);
      const r = Number(radiusKm);
      if (!Number.isFinite(la) || !Number.isFinite(ln) || !(r > 0)) return null;
      return { center: [ln, la], radius_km: r };
    }
    const pts = parsePoints(pointsText);
    if (pts.length < 3) return null;
    return { points: pts };
  }

  function submit() {
    const geometry = buildGeometry();
    if (!geometry) return;
    const body = {
      name,
      geometry_type: type,
      geometry,
      fee_ngn: Number(fee) || 0,
      priority: Number(priority) || 0,
      is_active: active,
      country_code: country || undefined,
    };
    if (isNew) create.mutate(body, { onSuccess: onClose });
    else update.mutate({ id: zone!.zone_id, patch: body }, { onSuccess: onClose });
  }

  const geometryValid = buildGeometry() != null;
  const canSave =
    !!name &&
    !!fee &&
    (type === "country" ? !!country : geometryValid) &&
    !busy;

  return (
    <Drawer open onClose={onClose} title={isNew ? "New zone" : "Edit zone"} subtitle="Geofenced delivery fee">
      <div className="space-y-4 p-1">
        <Field label="Zone name">
          <Input value={name} onChange={setName} placeholder="Lekki / Ikoyi" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Delivery fee (₦)">
            <Input value={fee} onChange={(v) => setFee(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
          </Field>
          <Field label="Priority (higher wins)">
            <Input value={priority} onChange={(v) => setPriority(v.replace(/[^0-9]/g, ""))} placeholder="0" mono />
          </Field>
        </div>

        <Field label="Coverage">
          <Select
            value={type}
            onChange={(v) => setType(v as ZoneGeometryType)}
            options={[
              { value: "country", label: "Whole country (flat fee)" },
              { value: "radius", label: "Local — centre + radius" },
              { value: "polygon", label: "Local — polygon (points)" },
            ]}
          />
        </Field>

        {type === "country" ? (
          <Field label="Country">
            <Select
              value={country}
              onChange={setCountry}
              options={[
                { value: "", label: "Choose a country…" },
                ...COUNTRY_OPTIONS,
              ]}
            />
          </Field>
        ) : (
          <>
            {mapsReady && (
              <ZoneMap
                type={type}
                initialPoints={parsePoints(pointsText)}
                initialCenter={
                  centerLat && centerLng
                    ? [Number(centerLng), Number(centerLat)]
                    : null
                }
                radiusKm={Number(radiusKm) || 0}
                onPoints={(pts) => setPointsText(pts.map((p) => `${p[0]}, ${p[1]}`).join("\n"))}
                onCenter={(c) => {
                  setCenterLng(c[0].toFixed(6));
                  setCenterLat(c[1].toFixed(6));
                }}
              />
            )}

            {type === "radius" ? (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Centre lat">
                  <Input value={centerLat} onChange={(v) => setCenterLat(v.replace(/[^0-9.\-]/g, ""))} placeholder="6.45" mono />
                </Field>
                <Field label="Centre lng">
                  <Input value={centerLng} onChange={(v) => setCenterLng(v.replace(/[^0-9.\-]/g, ""))} placeholder="3.47" mono />
                </Field>
                <Field label="Radius (km)">
                  <Input value={radiusKm} onChange={(v) => setRadiusKm(v.replace(/[^0-9.]/g, ""))} placeholder="5" mono />
                </Field>
              </div>
            ) : (
              <Field label="Polygon points — one “lng, lat” per line (min 3)">
                <textarea
                  value={pointsText}
                  onChange={(e) => setPointsText(e.target.value)}
                  rows={5}
                  placeholder={"3.41, 6.43\n3.49, 6.43\n3.49, 6.47\n3.41, 6.47"}
                  className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[12px] font-mono outline-none focus:border-accent/50 resize-y"
                />
              </Field>
            )}

            <Field label="Country (optional — scopes this local zone)">
              <Select
                value={country}
                onChange={setCountry}
                options={[
                  { value: "", label: "Any country" },
                  ...COUNTRY_OPTIONS,
                ]}
              />
            </Field>
          </>
        )}

        <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent" />
          Active
        </label>

        {type === "country" && !country && (name || fee) && (
          <p className="text-[11.5px] text-warn">Pick a country for this zone.</p>
        )}
        {type !== "country" && !geometryValid && (name || fee) && (
          <p className="text-[11.5px] text-warn">
            {type === "radius"
              ? "Enter a valid centre (lat/lng) and a positive radius."
              : "Enter at least 3 valid “lng, lat” points."}
          </p>
        )}
        {(create.isError || update.isError) && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t save the zone.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={submit}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          >
            {isNew ? "Create zone" : "Save"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function PointTester({ onClose }: { onClose: () => void }) {
  const quote = useZoneQuote();
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const runQuote = quote.mutate;
  const fromPlace = useCallback(
    (f: PlaceFields) => {
      if (f.latitude != null && f.longitude != null) {
        setLat(String(f.latitude));
        setLng(String(f.longitude));
        runQuote({ lat: f.latitude, lng: f.longitude });
      }
    },
    [runQuote],
  );

  const [mapsReady, setMapsReady] = useState(false);

  useEffect(() => {
    isGoogleMapsConfigured().then((ok) => setMapsReady(ok));
  }, []);

  return (
    <Drawer open onClose={onClose} title="Test a point" subtitle="Which zone covers it?">
      <div className="space-y-4 p-1">
        {mapsReady && (
          <GooglePlacesAutocomplete
            label="Search an address"
            countryRestriction={null}
            onChange={fromPlace}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <Input value={lat} onChange={(v) => setLat(v.replace(/[^0-9.\-]/g, ""))} placeholder="6.45" mono />
          </Field>
          <Field label="Longitude">
            <Input value={lng} onChange={(v) => setLng(v.replace(/[^0-9.\-]/g, ""))} placeholder="3.47" mono />
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={!lat || !lng || quote.isPending}
          onClick={() => quote.mutate({ lat: Number(lat), lng: Number(lng) })}
          icon={quote.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
        >
          Resolve fee
        </Button>

        {quote.data && (
          <div className="rounded-xl border border-line p-3.5">
            {quote.data.zone_id ? (
              <>
                <div className="text-[13px] font-medium">{quote.data.zone_name}</div>
                <div className="font-display text-[24px] tabular-nums mt-1">{money(quote.data.fee_ngn ?? 0)}</div>
              </>
            ) : (
              <p className="text-[12.5px] text-text-faint italic">No zone covers this point.</p>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
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

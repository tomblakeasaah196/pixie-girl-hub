import { useState, useEffect } from "react";
import { MapPin, Plus, Pencil } from "lucide-react";
import { Button, Card, EmptyState, Pill, Skeleton } from "@/components/ui/primitives";
import { ErrorState, Select, Toggle } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { useAuthStore } from "@/stores/auth";
import { useStockLocations, useStockMutations } from "./hooks";
import type { StockLocation } from "./types";
import { LocationTypePill, FieldLabel, TextInput, InfoBanner } from "./parts";

/* ─── Constants ─── */

const LOCATION_TYPE_OPTIONS = [
  { value: "warehouse", label: "Warehouse" },
  { value: "amazon_fba", label: "Amazon FBA" },
  { value: "salon", label: "Salon" },
  { value: "retail_counter", label: "Retail Counter" },
  { value: "showroom", label: "Showroom" },
];

/* ─── Main Component ─── */

export default function LocationsTab() {
  const { can } = useAuthStore();
  const canCreate = can("stock", "create");
  const canEdit = can("stock", "edit");

  const locationsQ = useStockLocations();
  const locations = locationsQ.data ?? [];

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StockLocation | null>(null);

  const openAdd = () => {
    setEditTarget(null);
    setDrawerOpen(true);
  };

  const openEdit = (loc: StockLocation) => {
    setEditTarget(loc);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditTarget(null);
  };

  /* ─── Render ─── */

  if (locationsQ.isError) {
    return (
      <ErrorState message="Failed to load locations." onRetry={() => locationsQ.refetch()} />
    );
  }

  if (locationsQ.isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-3 animate-pulse">
            <Skeleton className="h-5 w-24 rounded" />
            <Skeleton className="h-4 w-40 rounded" />
            <Skeleton className="h-3 w-32 rounded" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="space-y-4">
        {canCreate && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={openAdd}
            >
              Add Location
            </Button>
          </div>
        )}
        <EmptyState
          icon={<MapPin className="w-10 h-10" />}
          title="No locations configured"
          message="Add a warehouse, salon or retail location to start tracking stock."
          action={
            canCreate ? (
              <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
                Add Location
              </Button>
            ) : undefined
          }
        />
        <LocationDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          editTarget={editTarget}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      {canCreate && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={openAdd}
          >
            Add Location
          </Button>
        </div>
      )}

      {/* ── Cards Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {locations.map((loc) => (
          <Card key={loc.location_id} className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <LocationTypePill type={loc.location_type} />
              {canEdit && (
                <button
                  onClick={() => openEdit(loc)}
                  className="p-1.5 rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
                  title="Edit location"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">{loc.display_name}</h3>
              <p className="text-[12px] text-text-muted font-mono">{loc.location_code}</p>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-1.5">
              {loc.is_default && <Pill tone="accent">Default</Pill>}
              {loc.available_for_pos && <Pill tone="success">POS</Pill>}
              {loc.available_for_storefront && <Pill tone="info">Storefront</Pill>}
              {loc.location_type === "amazon_fba" && <Pill tone="warn">Consignment</Pill>}
              {!loc.is_active && <Pill tone="danger">Inactive</Pill>}
            </div>

            {/* Address */}
            {(loc.city || loc.country) && (
              <p className="text-[12px] text-text-faint">
                {[loc.city, loc.country].filter(Boolean).join(", ")}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* ── Drawer ── */}
      <LocationDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        editTarget={editTarget}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════
   Location Drawer (Add / Edit)
   ═══════════════════════════════════════════ */

function LocationDrawer({
  open,
  onClose,
  editTarget,
}: {
  open: boolean;
  onClose: () => void;
  editTarget: StockLocation | null;
}) {
  const mutations = useStockMutations();
  const isEdit = !!editTarget;

  const [displayName, setDisplayName] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [locationType, setLocationType] = useState("warehouse");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [availableForPos, setAvailableForPos] = useState(false);
  const [availableForStorefront, setAvailableForStorefront] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const isAmazonFba = locationType === "amazon_fba";

  /* populate form on edit */
  useEffect(() => {
    if (editTarget) {
      setDisplayName(editTarget.display_name);
      setLocationCode(editTarget.location_code);
      setLocationType(editTarget.location_type);
      setAddress(editTarget.address ?? "");
      setCity(editTarget.city ?? "");
      setState(editTarget.state ?? "");
      setCountry(editTarget.country ?? "");
      setAvailableForPos(editTarget.available_for_pos);
      setAvailableForStorefront(editTarget.available_for_storefront);
      setIsDefault(editTarget.is_default);
      setIsActive(editTarget.is_active);
    } else {
      setDisplayName("");
      setLocationCode("");
      setLocationType("warehouse");
      setAddress("");
      setCity("");
      setState("");
      setCountry("");
      setAvailableForPos(false);
      setAvailableForStorefront(false);
      setIsDefault(false);
      setIsActive(true);
    }
  }, [editTarget, open]);

  /* auto-suggest code from name */
  const handleNameChange = (v: string) => {
    setDisplayName(v);
    if (!isEdit) {
      setLocationCode(
        v
          .toUpperCase()
          .replace(/[^A-Z0-9\s]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 20),
      );
    }
  };

  /* disable POS/storefront toggles for Amazon FBA */
  useEffect(() => {
    if (isAmazonFba) {
      setAvailableForPos(false);
      setAvailableForStorefront(false);
    }
  }, [isAmazonFba]);

  const canSave = displayName.trim() && locationCode.trim();

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        display_name: displayName.trim(),
        location_code: locationCode.trim(),
        location_type: locationType,
        address: address || null,
        city: city || null,
        state: state || null,
        country: country || null,
        available_for_pos: availableForPos,
        available_for_storefront: availableForStorefront,
        is_default: isDefault,
        is_active: isActive,
      };

      if (isEdit && editTarget) {
        await mutations.updateLocation.mutateAsync({
          id: editTarget.location_id,
          patch: payload,
        });
      } else {
        await mutations.createLocation.mutateAsync(payload);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Location" : "Add Location"}
      footer={
        <Button variant="primary" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      }
    >
      <div className="space-y-5 p-1">
        <div>
          <FieldLabel>Display Name</FieldLabel>
          <TextInput
            value={displayName}
            onChange={handleNameChange}
            placeholder="e.g. Lagos Main Warehouse"
            required
          />
        </div>

        <div>
          <FieldLabel>Location Code</FieldLabel>
          <TextInput
            value={locationCode}
            onChange={setLocationCode}
            placeholder="e.g. LAGOS_MAIN"
            required
          />
        </div>

        <div>
          <FieldLabel>Type</FieldLabel>
          <Select value={locationType} onChange={setLocationType} options={LOCATION_TYPE_OPTIONS} />
        </div>

        {isAmazonFba && (
          <InfoBanner>
            Amazon FBA locations are consignment. Stock deducted only when sales are reported from
            Amazon.
          </InfoBanner>
        )}

        <div>
          <FieldLabel>Address</FieldLabel>
          <TextInput value={address} onChange={setAddress} placeholder="Street address (optional)" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>City</FieldLabel>
            <TextInput value={city} onChange={setCity} placeholder="City" />
          </div>
          <div>
            <FieldLabel>State</FieldLabel>
            <TextInput value={state} onChange={setState} placeholder="State" />
          </div>
        </div>

        <div>
          <FieldLabel>Country</FieldLabel>
          <TextInput value={country} onChange={setCountry} placeholder="Country" />
        </div>

        <div className="space-y-3 pt-2 border-t border-line">
          <Toggle
            checked={availableForPos}
            onChange={setAvailableForPos}
            label="Available for POS?"
            disabled={isAmazonFba}
          />
          <Toggle
            checked={availableForStorefront}
            onChange={setAvailableForStorefront}
            label="Available for storefront?"
            disabled={isAmazonFba}
          />
          <Toggle
            checked={isDefault}
            onChange={setIsDefault}
            label="Set as default?"
          />
          <Toggle
            checked={isActive}
            onChange={setIsActive}
            label="Active?"
          />
        </div>
      </div>
    </Drawer>
  );
}

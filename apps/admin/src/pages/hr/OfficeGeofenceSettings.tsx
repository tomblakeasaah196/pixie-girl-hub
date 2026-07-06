/**
 * Office geofence settings (HR attendance). HR sets each office's location and
 * a clock-in perimeter (radius). Clock-ins outside every active office on an
 * on-site day are flagged and queried.
 *
 * The location is picked with GeoapifyOfficePicker — an interactive Geoapify
 * static map + address search, no browser Maps SDK (replacing the Google Maps
 * picker that hung on "Loading map…" / "t.maps.Map is not a constructor"). The
 * perimeter check itself is server-side haversine math; coordinates are the
 * truth, the reverse-geocoded address is a stored display label.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import {
  listGeofences,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  type Geofence,
} from "@/lib/hr-api";
import { SectionTitle, useNotify, errMsg } from "./hr-shared";
import { GeoapifyOfficePicker } from "./GeoapifyOfficePicker";

const LAGOS = { lat: 6.5244, lng: 3.3792 };

function OfficeModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Geofence | null;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [form, setForm] = useState({
    name: "",
    latitude: LAGOS.lat,
    longitude: LAGOS.lng,
    radius_m: 150,
    address: "",
  });

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              name: editing.name,
              latitude: Number(editing.latitude),
              longitude: Number(editing.longitude),
              radius_m: editing.radius_m,
              address: editing.address ?? "",
            }
          : {
              name: "",
              latitude: LAGOS.lat,
              longitude: LAGOS.lng,
              radius_m: 150,
              address: "",
            },
      );
    }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        radius_m: form.radius_m,
        address: form.address.trim() || undefined,
      };
      return editing
        ? updateGeofence(editing.geofence_id, payload)
        : createGeofence(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "geofences"] });
      notify(editing ? "Office updated" : "Office added");
      onClose();
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? "Edit office" : "Add office"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.name.trim() || save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save office"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Office name (e.g. Lekki HQ)"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary"
        />

        <GeoapifyOfficePicker
          lat={form.latitude}
          lng={form.longitude}
          radius={form.radius_m}
          address={form.address}
          onChange={(patch) =>
            setForm((f) => ({
              ...f,
              ...(patch.lat !== undefined ? { latitude: patch.lat } : {}),
              ...(patch.lng !== undefined ? { longitude: patch.lng } : {}),
              ...(patch.address !== undefined ? { address: patch.address } : {}),
            }))
          }
        />

        <label className="block text-xs font-medium text-text-muted">
          Clock-in radius: <span className="text-text-primary">{form.radius_m} m</span>
          <input
            type="range"
            min={50}
            max={1000}
            step={10}
            value={form.radius_m}
            onChange={(e) => setForm({ ...form, radius_m: Number(e.target.value) })}
            className="mt-1 w-full accent-[#690909]"
          />
          <span className="text-[11px] text-text-faint">
            GPS indoors can drift 20–100 m — 100–200 m avoids false flags.
          </span>
        </label>
      </div>
    </Modal>
  );
}

export function OfficeGeofenceSettings() {
  const qc = useQueryClient();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["hr", "geofences"],
    queryFn: listGeofences,
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteGeofence(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "geofences"] });
      notify("Office removed");
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  return (
    <Card className="p-5">
      <SectionTitle
        icon={<MapPin className="h-4 w-4 text-accent-glow" />}
        action={
          <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => { setEditing(null); setOpen(true); }}>
            Add office
          </Button>
        }
      >
        Offices & clock-in perimeters
      </SectionTitle>
      <p className="mb-3 text-xs text-text-muted">
        Staff must clock in within an office perimeter on on-site days. Off-site
        clock-ins are recorded, flagged, and auto-queried.
      </p>

      {isLoading ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : !data?.length ? (
        <EmptyState
          icon={<MapPin className="h-6 w-6" />}
          title="No offices set"
          message="Add your first office so clock-ins can be checked against a perimeter."
        />
      ) : (
        <div className="space-y-2">
          {data.map((g) => (
            <div key={g.geofence_id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-text-primary/[0.03] p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-primary">{g.name}</span>
                  <Pill tone={g.is_active ? "success" : "neutral"}>{g.radius_m} m</Pill>
                </div>
                {g.address && (
                  <div className="mt-0.5 truncate text-xs text-text-muted">{g.address}</div>
                )}
                <div className="font-mono text-[11px] text-text-faint">
                  {Number(g.latitude).toFixed(5)}, {Number(g.longitude).toFixed(5)}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" onClick={() => { setEditing(g); setOpen(true); }}>Edit</Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => del.mutate(g.geofence_id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <OfficeModal open={open} onClose={() => setOpen(false)} editing={editing} />
    </Card>
  );
}

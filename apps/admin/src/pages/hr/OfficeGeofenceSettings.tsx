/// <reference types="@types/google.maps" />
/**
 * Office geofence settings (HR attendance). HR sets each office's location and
 * a clock-in perimeter (radius). Clock-ins outside every active office on an
 * on-site day are flagged and queried. Uses the already-loaded Google Maps for
 * the map UI only — the perimeter check is server-side haversine math.
 *
 * Degrades to manual lat/lng/radius inputs when Google Maps isn't configured.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Trash2, Crosshair } from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import {
  loadGoogleMaps,
  isGoogleMapsConfigured,
} from "@/lib/google-maps-loader";
import {
  listGeofences,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  type Geofence,
} from "@/lib/hr-api";
import { SectionTitle, useNotify, errMsg } from "./hr-shared";

const LAGOS = { lat: 6.5244, lng: 3.3792 };

function MapEditor({
  initial,
  onPick,
}: {
  initial: { lat: number; lng: number; radius: number };
  onPick: (lat: number, lng: number) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const [ready, setReady] = useState(false);

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !g || !mapEl.current) return;
      const center = { lat: initial.lat, lng: initial.lng };
      const map = new g.maps.Map(mapEl.current, {
        center,
        zoom: 16,
        disableDefaultUI: true,
        zoomControl: true,
      });
      const marker = new g.maps.Marker({ position: center, map, draggable: true });
      const circle = new g.maps.Circle({
        map,
        center,
        radius: initial.radius,
        fillColor: "#690909",
        fillOpacity: 0.12,
        strokeColor: "#690909",
        strokeOpacity: 0.5,
        strokeWeight: 1,
      });
      markerRef.current = marker;
      circleRef.current = circle;
      setReady(true);

      const move = (pos: google.maps.LatLng | null | undefined) => {
        if (!pos) return;
        marker.setPosition(pos);
        circle.setCenter(pos);
        onPick(pos.lat(), pos.lng());
      };
      marker.addListener("dragend", () => move(marker.getPosition()));
      map.addListener("click", (e: google.maps.MapMouseEvent) => move(e.latLng));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect radius changes.
  useEffect(() => {
    if (circleRef.current) circleRef.current.setRadius(initial.radius);
  }, [initial.radius]);

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-xl border border-line">
      <div ref={mapEl} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">
          Loading map…
        </div>
      )}
    </div>
  );
}

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
  const mapsOk = isGoogleMapsConfigured();
  const [form, setForm] = useState({
    name: "",
    latitude: LAGOS.lat,
    longitude: LAGOS.lng,
    radius_m: 150,
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
            }
          : { name: "", latitude: LAGOS.lat, longitude: LAGOS.lng, radius_m: 150 },
      );
    }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateGeofence(editing.geofence_id, {
            name: form.name,
            latitude: form.latitude,
            longitude: form.longitude,
            radius_m: form.radius_m,
          })
        : createGeofence({
            name: form.name,
            latitude: form.latitude,
            longitude: form.longitude,
            radius_m: form.radius_m,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "geofences"] });
      notify(editing ? "Office updated" : "Office added");
      onClose();
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition((p) =>
      setForm((f) => ({ ...f, latitude: p.coords.latitude, longitude: p.coords.longitude })),
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
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

        {mapsOk ? (
          <MapEditor
            initial={{ lat: form.latitude, lng: form.longitude, radius: form.radius_m }}
            onPick={(lat, lng) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <input type="number" step="0.0000001" value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: Number(e.target.value) })}
              placeholder="Latitude"
              className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
            <input type="number" step="0.0000001" value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: Number(e.target.value) })}
              placeholder="Longitude"
              className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button size="sm" icon={<Crosshair className="h-3.5 w-3.5" />} onClick={useMyLocation}>
            Use my location
          </Button>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="font-mono">
              {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
            </span>
          </div>
        </div>

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
                <div className="font-mono text-xs text-text-muted">
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

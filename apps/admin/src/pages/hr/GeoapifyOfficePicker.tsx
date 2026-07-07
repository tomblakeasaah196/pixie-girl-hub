/**
 * Office-location picker (HR attendance geofences) — Geoapify, no browser SDK.
 *
 * Replaces the Google-Maps picker that failed with "t.maps.Map is not a
 * constructor" and hung on "Loading map…". Everything here is Geoapify, via our
 * own server proxy (the key stays server-side):
 *
 *   • Address search  — type an address, pick a suggestion; it drops the pin on
 *                       the exact coordinates and fills the address label.
 *   • Map surface     — a Geoapify STATIC map image with the pin fixed at the
 *                       centre. Click to drop the pin, drag to pan, ± to zoom.
 *                       The clock-in radius is a live overlay circle.
 *   • Coordinates     — the picked lat/lng shown precisely (JetBrains Mono).
 *
 * The pin is ALWAYS the map centre, so the picked point == props.lat/lng and
 * the maths stays trivial (see geo-mercator). Clicks/pans/zoom that change the
 * centre reverse-geocode (debounced) to keep the address label honest; a search
 * pick sets the address directly.
 */

import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Minus, Crosshair, Search, Loader2 } from "lucide-react";
import { geoStatus, geoSearch, geoReverse, fetchStaticMapUrl, type GeoSuggestion } from "@/lib/geoapify";
import { metersPerPixel, pointAt, panCenter, zoomForRadius } from "@/lib/geo-mercator";
import { cn } from "@/lib/cn";

// Off-screen headroom (px) around the static image so a drag doesn't reveal
// blank edges before it settles.
const PAD = 48;
// Below this pointer travel a press counts as a click (drop pin), not a pan.
const CLICK_PX = 5;

interface Props {
  lat: number;
  lng: number;
  radius: number;
  address: string;
  onChange: (patch: { lat?: number; lng?: number; address?: string }) => void;
}

export function GeoapifyOfficePicker({ lat, lng, radius, address, onChange }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [zoom, setZoom] = useState(() => zoomForRadius(lat, radius, 288));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState(false);
  const [locating, setLocating] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });

  const surfaceRef = useRef<HTMLDivElement>(null);
  const mapUrlRef = useRef<string | null>(null);
  const mapSeq = useRef(0);
  const revSeq = useRef(0);
  const revTimer = useRef<number | null>(null);
  const searchSeq = useRef(0);
  const searchTimer = useRef<number | null>(null);
  // Live lat/lng for handlers/effects that must not re-subscribe on pin moves.
  const posRef = useRef({ lat, lng });
  posRef.current = { lat, lng };
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // ── availability + cleanup ───────────────────────────────
  useEffect(() => {
    let alive = true;
    geoStatus()
      .then((s) => alive && setConfigured(Boolean(s.configured)))
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (mapUrlRef.current) URL.revokeObjectURL(mapUrlRef.current);
      if (revTimer.current) window.clearTimeout(revTimer.current);
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    },
    [],
  );

  // ── measure the map surface (drives the image dimensions) ─
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [configured]);

  // ── (re)fetch the centred static map ─────────────────────
  useEffect(() => {
    if (configured !== true || !size.w || !size.h) return;
    const seq = ++mapSeq.current;
    setMapLoading(true);
    setMapError(false);
    fetchStaticMapUrl({ lat, lng, zoom, width: size.w + PAD * 2, height: size.h + PAD * 2 })
      .then((url) => {
        if (mapSeq.current !== seq) {
          URL.revokeObjectURL(url);
          return;
        }
        if (mapUrlRef.current) URL.revokeObjectURL(mapUrlRef.current);
        mapUrlRef.current = url;
        setMapUrl(url);
        setMapLoading(false);
      })
      .catch(() => {
        if (mapSeq.current !== seq) return;
        setMapError(true);
        setMapLoading(false);
      });
  }, [configured, lat, lng, zoom, size.w, size.h]);

  // ── address search (debounced, biased to the current pin) ─
  useEffect(() => {
    if (configured !== true) return;
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const seq = ++searchSeq.current;
    searchTimer.current = window.setTimeout(async () => {
      try {
        const r = await geoSearch(q, posRef.current);
        if (searchSeq.current === seq) {
          setResults(r);
          setOpen(true);
        }
      } catch {
        /* best-effort — leave the box usable */
      }
    }, 300);
  }, [query, configured]);

  // ── committing a new centre (click / pan / locate) ───────
  const commit = (nlat: number, nlng: number) => {
    onChange({ lat: nlat, lng: nlng });
    const seq = ++revSeq.current;
    if (revTimer.current) window.clearTimeout(revTimer.current);
    revTimer.current = window.setTimeout(async () => {
      try {
        const { address: addr } = await geoReverse(nlat, nlng);
        if (revSeq.current === seq && addr) onChange({ address: addr });
      } catch {
        /* keep the last known label */
      }
    }, 500);
  };

  const pickSuggestion = (s: GeoSuggestion) => {
    setQuery(s.formatted);
    setResults([]);
    setOpen(false);
    setZoom((z) => Math.max(z, 16));
    onChange({ lat: s.lat, lng: s.lng, address: s.formatted });
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setZoom((z) => Math.max(z, 16));
        commit(p.coords.latitude, p.coords.longitude);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  // ── pointer: click to drop, drag to pan ──────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_PX) return;
    d.moved = true;
    setDragOffset({ dx, dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const el = surfaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setDragOffset({ dx: 0, dy: 0 });
    if (!d.moved && Math.hypot(dx, dy) < CLICK_PX) {
      // Click → the clicked point becomes the new centre/pin.
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const p = pointAt(lat, lng, zoom, px, py, rect.width, rect.height);
      commit(p.lat, p.lng);
    } else {
      // Pan → the centre shifts opposite the drag.
      const p = panCenter(lat, lng, zoom, dx, dy);
      commit(p.lat, p.lng);
    }
  };

  // ── manual coordinate entry (fallback) ───────────────────
  const manualInputs = (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-[11px] font-medium text-text-muted">
        Latitude
        <input
          type="number"
          step="0.0000001"
          value={lat}
          onChange={(e) => onChange({ lat: Number(e.target.value) })}
          className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 font-mono text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </label>
      <label className="block text-[11px] font-medium text-text-muted">
        Longitude
        <input
          type="number"
          step="0.0000001"
          value={lng}
          onChange={(e) => onChange({ lng: Number(e.target.value) })}
          className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 font-mono text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </label>
    </div>
  );

  if (configured === null) {
    return (
      <div className="grid h-72 w-full place-items-center rounded-xl border border-line bg-text-primary/[0.02] text-xs text-text-muted">
        <span className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing map…
        </span>
      </div>
    );
  }

  if (configured === false) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-line bg-text-primary/[0.02] p-3 text-[12px] text-text-faint">
          Map search isn&rsquo;t configured (no Geoapify key) — enter the
          office coordinates directly. You can copy them from Google Maps
          (right-click a spot → the lat, lng at the top).
        </div>
        {manualInputs}
      </div>
    );
  }

  // Circle + marker overlays: the pin is the map centre, so both sit at the
  // surface centre. Radius → pixels via the ground resolution at this zoom.
  const mpp = metersPerPixel(lat, zoom);
  const circleDiameter = mpp > 0 ? (radius * 2) / mpp : 0;

  return (
    <div className="space-y-2.5">
      {/* Address search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              pickSuggestion(results[0]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search the office address (e.g. 15 Adeola Odeku, Victoria Island)…"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] py-2.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-faint focus:border-accent/50 focus:outline-none" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
        {open && results.length > 0 && (
          <ul className="dropglass absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-line py-1 shadow-glass">
            {results.map((r, i) => (
              <li key={r.place_id ?? `${r.lat},${r.lng},${i}`}>
                <button
                  type="button"
                  onClick={() => pickSuggestion(r)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-text-primary/[0.06]"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-glow" />
                  <span className="min-w-0">
                    <span className="block truncate">{r.formatted}</span>
                    {(r.city || r.country) && (
                      <span className="block truncate text-[11px] text-text-faint">
                        {[r.city, r.country].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Map surface (or coordinate fallback on failure) */}
      {mapError ? (
        <div className="space-y-2">
          <div className="rounded-xl border border-line bg-text-primary/[0.02] p-3 text-[12px] text-text-faint">
            Couldn&rsquo;t load the map just now — search above still works, or
            set the coordinates directly.
          </div>
          {manualInputs}
        </div>
      ) : (
        <div
          ref={surfaceRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative h-72 w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl border border-line bg-panel-2"
        >
          {mapUrl && (
            <img
              src={mapUrl}
              alt="Office location map"
              draggable={false}
              style={{
                position: "absolute",
                top: -PAD,
                left: -PAD,
                width: size.w + PAD * 2,
                height: size.h + PAD * 2,
                transform: `translate(${dragOffset.dx}px, ${dragOffset.dy}px)`,
                maxWidth: "none",
              }}
            />
          )}

          {/* Radius circle (centred on the pin) */}
          {circleDiameter > 0 && (
            <div
              className="pointer-events-none absolute rounded-full border-2 border-accent/70 bg-accent/15"
              style={{
                width: circleDiameter,
                height: circleDiameter,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }}
            />
          )}

          {/* Centre pin (tip at exact centre) + a precise dot */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="block h-1.5 w-1.5 rounded-full bg-accent-glow shadow-[0_0_0_2px_rgba(0,0,0,0.5)]" />
          </div>
          <MapPin
            className="pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-full text-accent-glow drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]"
            fill="currentColor"
            strokeWidth={1.5}
          />

          {/* Zoom controls */}
          <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-lg border border-line bg-panel/85 backdrop-blur">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(19, z + 1))}
              className="grid h-8 w-8 place-items-center text-text-primary hover:bg-text-primary/10"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(3, z - 1))}
              className="grid h-8 w-8 place-items-center border-t border-line text-text-primary hover:bg-text-primary/10"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>

          {mapLoading && (
            <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-panel/85 px-2 py-1 text-[11px] text-text-muted backdrop-blur">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-panel/80 px-2 py-1 text-[10.5px] text-text-faint backdrop-blur">
            Click to drop the pin · drag to pan · use ± to zoom
          </div>
        </div>
      )}

      {/* Address + coordinate readout */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-text-primary/[0.04] px-2.5 py-1.5 text-xs text-text-primary hover:bg-text-primary/[0.08] disabled:opacity-60"
        >
          {locating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Crosshair className="h-3.5 w-3.5" />
          )}
          Use my location
        </button>
        <span className="font-mono text-xs text-text-muted">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
      </div>
      <div
        className={cn(
          "flex items-start gap-1.5 rounded-lg border border-line bg-text-primary/[0.03] px-2.5 py-2 text-xs",
          address ? "text-text-primary" : "text-text-faint",
        )}
      >
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-glow" />
        <span className="min-w-0">{address || "Pick a point or search to capture the office address"}</span>
      </div>
    </div>
  );
}

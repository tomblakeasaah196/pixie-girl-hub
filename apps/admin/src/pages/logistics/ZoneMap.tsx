import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

/**
 * Google-Maps drawing surface for a delivery zone.
 *
 * Polygon mode: click the map to drop boundary points; drag vertices to edit.
 * Radius mode: drag the centre marker (or click to move it); the circle radius
 * follows the `radiusKm` field. The map WRITES geometry up via callbacks; the
 * coordinate fields in the editor stay as a precise/fallback input.
 */

type LngLat = [number, number];

declare global {
  interface Window {
    // Google calls this on an auth/billing/API-not-enabled failure.
    gm_authFailure?: () => void;
  }
}

const LAGOS = { lat: 6.45, lng: 3.4 };

export function ZoneMap({
  type,
  initialPoints,
  initialCenter,
  radiusKm,
  onPoints,
  onCenter,
}: {
  type: "polygon" | "radius";
  initialPoints: LngLat[];
  initialCenter: LngLat | null;
  radiusKm: number;
  onPoints: (p: LngLat[]) => void;
  onCenter: (c: LngLat) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polyRef = useRef<google.maps.Polygon | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const cb = useRef({ onPoints, onCenter });
  cb.current = { onPoints, onCenter };
  const init = useRef({ initialPoints, initialCenter });
  init.current = { initialPoints, initialCenter };
  const typeRef = useRef(type);
  typeRef.current = type;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Surface Google's auth/billing/API-not-enabled failure as our own fallback
  // instead of Google's full-bleed "Oops" overlay.
  useEffect(() => {
    window.gm_authFailure = () => setError(true);
    return () => {
      window.gm_authFailure = undefined;
    };
  }, []);

  // Load + create the map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !elRef.current) return;
        if (!g) {
          setError(true);
          return;
        }
        const { initialPoints: pts, initialCenter: ctr } = init.current;
        const center = ctr
          ? { lat: ctr[1], lng: ctr[0] }
          : pts[0]
            ? { lat: pts[0][1], lng: pts[0][0] }
            : LAGOS;
        mapRef.current = new g.maps.Map(elRef.current, {
          center,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        setReady(true);
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)build overlays when the map is ready or the shape type changes.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map) return;

    polyRef.current?.setMap(null);
    polyRef.current = null;
    markerRef.current?.setMap(null);
    markerRef.current = null;
    circleRef.current?.setMap(null);
    circleRef.current = null;

    const { initialPoints: pts, initialCenter: ctr } = init.current;
    const listeners: google.maps.MapsEventListener[] = [];

    try {
      if (type === "polygon") {
        const poly = new g.maps.Polygon({
          map,
          paths: pts.map(([lng, lat]) => ({ lat, lng })),
          editable: true,
          strokeColor: "#690909",
          strokeWeight: 2,
          fillColor: "#A81D1D",
          fillOpacity: 0.18,
        });
        polyRef.current = poly;
        const emit = () => {
          const arr: LngLat[] = [];
          poly.getPath().forEach((p) => arr.push([p.lng(), p.lat()]));
          cb.current.onPoints(arr);
        };
        const path = poly.getPath();
        listeners.push(path.addListener("set_at", emit));
        listeners.push(path.addListener("insert_at", emit));
        listeners.push(path.addListener("remove_at", emit));
        listeners.push(
          map.addListener("click", (e: google.maps.MapMouseEvent) => {
            if (!e.latLng) return;
            poly.getPath().push(e.latLng);
            emit();
          }),
        );
      } else {
        const c = ctr
          ? { lat: ctr[1], lng: ctr[0] }
          : (map.getCenter()?.toJSON() ?? LAGOS);
        const marker = new g.maps.Marker({ map, position: c, draggable: true });
        const circle = new g.maps.Circle({
          map,
          center: c,
          radius: Math.max(0.1, radiusKm || 1) * 1000,
          strokeColor: "#690909",
          strokeWeight: 2,
          fillColor: "#A81D1D",
          fillOpacity: 0.15,
        });
        markerRef.current = marker;
        circleRef.current = circle;
        const sync = (pos: google.maps.LatLng) => {
          circle.setCenter(pos);
          cb.current.onCenter([pos.lng(), pos.lat()]);
        };
        listeners.push(
          marker.addListener("dragend", () => {
            const p = marker.getPosition();
            if (p) sync(p);
          }),
        );
        listeners.push(
          map.addListener("click", (e: google.maps.MapMouseEvent) => {
            if (!e.latLng) return;
            marker.setPosition(e.latLng);
            sync(e.latLng);
          }),
        );
      }
    } catch {
      // Maps failed to initialise (e.g. key/referrer rejected). Fall back to
      // manual coordinate entry instead of crashing the page.
      setError(true);
      return;
    }

    return () => {
      for (const l of listeners) g.maps.event.removeListener(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, type]);

  // Keep the radius circle in sync with the km field.
  useEffect(() => {
    if (type === "radius" && circleRef.current) {
      circleRef.current.setRadius(Math.max(0.1, radiusKm || 1) * 1000);
    }
  }, [radiusKm, type]);

  // Place/area search → jump there and auto-fill the geometry (no coordinates
  // to know by heart). Radius: drop the centre on the place. Polygon: seed the
  // boundary from the area's bounding box, ready to refine.
  useEffect(() => {
    const g = window.google;
    const map = mapRef.current;
    if (!ready || !g || !map || !searchRef.current) return;
    if (!g.maps.places?.Autocomplete) return; // Places library unavailable
    let ac: google.maps.places.Autocomplete;
    try {
      ac = new g.maps.places.Autocomplete(searchRef.current, {
        fields: ["geometry", "name"],
      });
      ac.bindTo("bounds", map);
    } catch {
      return; // search box stays inert; map/manual entry still work
    }
    const l = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const geo = place.geometry;
      if (!geo) return;
      if (geo.viewport) map.fitBounds(geo.viewport);
      else if (geo.location) {
        map.setCenter(geo.location);
        map.setZoom(13);
      }
      const loc = geo.location;
      if (typeRef.current === "radius" && loc) {
        markerRef.current?.setPosition(loc);
        circleRef.current?.setCenter(loc);
        cb.current.onCenter([loc.lng(), loc.lat()]);
      } else if (typeRef.current === "polygon" && geo.viewport) {
        const ne = geo.viewport.getNorthEast();
        const sw = geo.viewport.getSouthWest();
        const rect: LngLat[] = [
          [sw.lng(), sw.lat()],
          [ne.lng(), sw.lat()],
          [ne.lng(), ne.lat()],
          [sw.lng(), ne.lat()],
        ];
        polyRef.current?.setPath(rect.map(([lng, lat]) => ({ lat, lng })));
        cb.current.onPoints(rect);
      }
    });
    return () => g.maps.event.removeListener(l);
  }, [ready]);

  if (error) {
    return (
      <div className="rounded-[11px] border border-line bg-text-primary/[0.02] p-4 text-[12px] text-text-faint flex items-center gap-2">
        <MapPin className="w-4 h-4" />
        Map unavailable — enter coordinates below.
      </div>
    );
  }

  return (
    <div className="relative rounded-[11px] overflow-hidden border border-line">
      <input
        ref={searchRef}
        placeholder="Search an area or place (e.g. Lekki Phase 1)…"
        className="absolute z-20 top-2 left-2 right-2 h-[38px] px-3 rounded-[10px] bg-panel/90 backdrop-blur border border-line text-[13px] outline-none focus:border-accent/50 shadow-glass"
      />
      <div ref={elRef} className="w-full h-[300px] bg-panel-2" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-panel-2/60">
          <Loader2 className="w-5 h-5 animate-spin text-text-faint" />
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 text-[10.5px] text-text-faint bg-panel/80 backdrop-blur rounded-md px-2 py-1">
        {type === "polygon"
          ? "Click to add boundary points · drag vertices to adjust"
          : "Drag the pin (or click) to set the centre · radius follows the km field"}
      </div>
    </div>
  );
}

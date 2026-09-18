"use client";

import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildBasemaps } from "@/lib/basemaps";
import type { Business } from "@/lib/types";

/**
 * Street tiles default to OpenStreetMap's own service because it genuinely
 * needs no key. Set NEXT_PUBLIC_TILE_URL (and NEXT_PUBLIC_TILE_ATTRIBUTION) to
 * use a commercial provider instead; nothing else has to change.
 */
const BASEMAPS = buildBasemaps(
  process.env.NEXT_PUBLIC_TILE_URL,
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION,
);

const MIN_RADIUS = 200;
const MAX_RADIUS = 8_000;

export interface MapViewProps {
  center: { lat: number; lon: number };
  radius: number;
  businesses: Business[];
  selectedId: string | null;
  targetIds: Set<string>;
  onSelect: (id: string | null) => void;
  onToggleTarget: (business: Business) => void;
  onOpenDetails: (business: Business) => void;
  onSearchArea: (center: { lat: number; lon: number }, radius: number) => void;
}

function markerIcon(business: Business, selected: boolean, targeted: boolean): L.DivIcon {
  const size = business.presence === "none" ? 17 : 14;
  return L.divIcon({
    className: "",
    html: `<div class="pin-marker" data-presence="${business.presence}" data-selected="${selected}" data-target="${targeted}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function MapView({
  center,
  radius,
  businesses,
  selectedId,
  targetIds,
  onSelect,
  onToggleTarget,
  onOpenDetails,
  onSearchArea,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const markerById = useRef(new Map<string, L.Marker>());
  /** Suppresses the "search this area" prompt while we move the map ourselves. */
  const programmatic = useRef(false);
  const [moved, setMoved] = useState(false);
  const [basemapId, setBasemapId] = useState("streets");
  const [tilesBroken, setTilesBroken] = useState(false);

  const selected = useMemo(
    () => businesses.find((business) => business.id === selectedId) ?? null,
    [businesses, selectedId],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lon],
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on("movestart zoomstart", () => {
      if (!programmatic.current) setMoved(true);
    });

    // Leaflet needs a nudge when it is mounted inside a flex/grid pane.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      circleRef.current = null;
      tileRef.current = null;
      markerById.current.clear();
    };
    // Mount only: subsequent centre changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap in place, keeping the current view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const basemap = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];
    tileRef.current?.remove();

    const layer = L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: basemap.maxZoom,
      ...(basemap.subdomains ? { subdomains: basemap.subdomains } : {}),
    });

    // A basemap that refuses to serve us should say so, not leave a blank grid.
    let loaded = 0;
    let failed = 0;
    setTilesBroken(false);
    layer.on("tileload", () => {
      loaded += 1;
      setTilesBroken(false);
    });
    layer.on("tileerror", () => {
      failed += 1;
      if (loaded === 0 && failed >= 4) setTilesBroken(true);
    });

    layer.addTo(map);
    layer.bringToBack();
    tileRef.current = layer;
  }, [basemapId]);

  // Recentre whenever a new search area arrives from outside the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    programmatic.current = true;
    map.fitBounds(L.latLng(center.lat, center.lon).toBounds(radius * 2), {
      animate: false,
      padding: [24, 24],
    });

    circleRef.current?.remove();
    circleRef.current = L.circle([center.lat, center.lon], {
      radius,
      color: "#4f8cff",
      weight: 1,
      opacity: 0.5,
      fillOpacity: 0.04,
      interactive: false,
    }).addTo(map);

    setMoved(false);
    const timer = setTimeout(() => {
      programmatic.current = false;
    }, 250);
    return () => clearTimeout(timer);
  }, [center.lat, center.lon, radius]);

  // Rebuild markers on every result change.
  useEffect(() => {
    const layer = markersRef.current;
    if (!layer) return;

    layer.clearLayers();
    markerById.current.clear();

    for (const business of businesses) {
      const marker = L.marker([business.lat, business.lon], {
        icon: markerIcon(business, business.id === selectedId, targetIds.has(business.id)),
        title: business.name,
        // Draw the opportunities on top of the businesses already covered.
        zIndexOffset: business.presence === "site" ? 0 : 500,
      });
      marker.on("click", () => onSelect(business.id));
      marker.bindTooltip(
        `<strong>${escapeHtml(business.name)}</strong><br>${escapeHtml(business.category)}`,
        { direction: "top", offset: [0, -10] },
      );
      marker.addTo(layer);
      markerById.current.set(business.id, marker);
    }
    // Selection and target state are applied by the effect below, which avoids
    // rebuilding every marker each time one of them changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businesses, onSelect]);

  // Restyle only the markers whose selection or target state actually changed.
  const appliedStyles = useRef(new Map<string, string>());
  useEffect(() => {
    for (const business of businesses) {
      const targeted = targetIds.has(business.id);
      const isSelected = business.id === selectedId;
      const signature = `${isSelected}:${targeted}`;
      if (appliedStyles.current.get(business.id) === signature) continue;

      appliedStyles.current.set(business.id, signature);
      markerById.current
        .get(business.id)
        ?.setIcon(markerIcon(business, isSelected, targeted));
    }

    const map = mapRef.current;
    const marker = selectedId ? markerById.current.get(selectedId) : null;
    if (map && marker && !map.getBounds().contains(marker.getLatLng())) {
      programmatic.current = true;
      map.panTo(marker.getLatLng());
      setTimeout(() => {
        programmatic.current = false;
      }, 250);
    }
  }, [selectedId, targetIds, businesses]);

  const searchVisibleArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const middle = map.getCenter();
    const bounds = map.getBounds();
    const toNorth = map.distance(middle, L.latLng(bounds.getNorth(), middle.lng));
    const toEast = map.distance(middle, L.latLng(middle.lat, bounds.getEast()));
    const visible = Math.min(toNorth, toEast);

    setMoved(false);
    onSearchArea(
      { lat: middle.lat, lon: middle.lng },
      Math.round(Math.min(Math.max(visible, MIN_RADIUS), MAX_RADIUS)),
    );
  }, [onSearchArea]);

  return (
    <div className="map-pane">
      <div
        ref={containerRef}
        className="map-root"
        data-basemap={basemapId}
        role="application"
        aria-label="Map of nearby businesses"
      />

      {tilesBroken && (
        <div className="map-tile-warning" role="status">
          Map tiles are not loading. The rest of the app still works — results and
          the target list are unaffected.
        </div>
      )}

      <div className="map-overlay">
        {moved && (
          <button type="button" className="map-action" onClick={searchVisibleArea}>
            Search this area
          </button>
        )}
      </div>

      <div className="basemap-switch" role="group" aria-label="Map style">
        {BASEMAPS.map((basemap) => (
          <button
            key={basemap.id}
            type="button"
            aria-pressed={basemapId === basemap.id}
            onClick={() => setBasemapId(basemap.id)}
          >
            {basemap.label}
          </button>
        ))}
      </div>

      {selected && (
        <div className="map-card">
          <button
            type="button"
            className="map-card-close"
            aria-label="Close"
            onClick={() => onSelect(null)}
          >
            ×
          </button>
          <div className="map-card-name">{selected.name}</div>
          <div className="map-card-meta">
            {selected.category}
            {selected.phone ? ` · ${selected.phone}` : ""}
          </div>
          <div className="map-card-actions">
            <button
              type="button"
              className={targetIds.has(selected.id) ? "button-primary" : "button-ghost"}
              onClick={() => onToggleTarget(selected)}
            >
              {targetIds.has(selected.id) ? "In target list" : "Add to targets"}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => onOpenDetails(selected)}
            >
              Open brief
            </button>
          </div>
        </div>
      )}

      <div className="map-legend">
        <div className="key">
          <span className="swatch" style={{ background: "var(--none)" }} /> No website
        </div>
        <div className="key">
          <span className="swatch" style={{ background: "var(--social)" }} /> Social only
        </div>
        <div className="key">
          <span className="swatch" style={{ background: "var(--site)" }} /> Has a website
        </div>
      </div>
    </div>
  );
}

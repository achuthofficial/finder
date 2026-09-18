"use client";

import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Business } from "@/lib/types";

const TILES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const MIN_RADIUS = 200;
const MAX_RADIUS = 15_000;

export interface MapViewProps {
  center: { lat: number; lon: number };
  radius: number;
  businesses: Business[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSearchArea: (center: { lat: number; lon: number }, radius: number) => void;
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function markerIcon(business: Business, selected: boolean): L.DivIcon {
  const size = business.presence === "none" ? 17 : 14;
  return L.divIcon({
    className: "",
    html: `<div class="pin-marker" data-presence="${business.presence}" data-selected="${selected}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function MapView({
  center,
  radius,
  businesses,
  selectedId,
  onSelect,
  onSearchArea,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const markerById = useRef(new Map<string, L.Marker>());
  /** Suppresses the "search this area" prompt while we move the map ourselves. */
  const programmatic = useRef(false);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lon],
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(prefersDark() ? TILES.dark : TILES.light, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

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
      markerById.current.clear();
    };
    // Mount only: subsequent centre changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentre whenever a new search area arrives from outside the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    programmatic.current = true;
    const bounds = L.latLng(center.lat, center.lon).toBounds(radius * 2);
    map.fitBounds(bounds, { animate: false, padding: [24, 24] });

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
        icon: markerIcon(business, business.id === selectedId),
        title: business.name,
        // Draw the opportunities on top of the businesses that are already covered.
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
    // `selectedId` is applied by the dedicated effect below to avoid a full rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businesses, onSelect]);

  // Restyle only the two markers whose selection state actually changed.
  const previousSelected = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousSelected.current;
    if (previous && previous !== selectedId) {
      const marker = markerById.current.get(previous);
      const business = businesses.find((b) => b.id === previous);
      if (marker && business) marker.setIcon(markerIcon(business, false));
    }

    if (selectedId) {
      const marker = markerById.current.get(selectedId);
      const business = businesses.find((b) => b.id === selectedId);
      if (marker && business) {
        marker.setIcon(markerIcon(business, true));
        const map = mapRef.current;
        if (map && !map.getBounds().contains(marker.getLatLng())) {
          programmatic.current = true;
          map.panTo(marker.getLatLng());
          setTimeout(() => {
            programmatic.current = false;
          }, 250);
        }
      }
    }
    previousSelected.current = selectedId;
  }, [selectedId, businesses]);

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
      <div ref={containerRef} className="map-root" role="application" aria-label="Map of nearby businesses" />

      {moved && (
        <div className="map-overlay">
          <button type="button" onClick={searchVisibleArea}>
            Search this area
          </button>
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import { TtlCache, UpstreamError, fetchWithTimeout } from "./http";
import type { GeocodeResult } from "./types";

const SEARCH = "https://nominatim.openstreetmap.org/search";
const REVERSE = "https://nominatim.openstreetmap.org/reverse";

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
  boundingbox?: [string, string, string, string];
}

const searchCache = new TtlCache<GeocodeResult[]>(60 * 60_000, 200);
const reverseCache = new TtlCache<string>(60 * 60_000, 200);

const METRES_PER_DEGREE = 111_320;

/**
 * Turn a feature's bounding box into a sensible search radius: a whole city
 * would otherwise either flood Overpass or return one block of a suburb.
 */
function radiusFromBox(box: NominatimPlace["boundingbox"], lat: number): number {
  if (!box) return 1500;
  const [south, north, west, east] = box.map(Number);
  if ([south, north, west, east].some(Number.isNaN)) return 1500;

  const latSpan = Math.abs(north - south) * METRES_PER_DEGREE;
  const lonSpan =
    Math.abs(east - west) * METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const half = Math.max(latSpan, lonSpan) / 2;

  return Math.round(Math.min(Math.max(half, 500), 10_000) / 100) * 100;
}

function toResult(place: NominatimPlace): GeocodeResult {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  return {
    label: place.display_name,
    lat,
    lon,
    suggestedRadius: radiusFromBox(place.boundingbox, lat),
    type: place.type,
  };
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const key = query.trim().toLowerCase();
  if (key.length < 2) return [];

  const cached = searchCache.get(key);
  if (cached) return cached;

  const url = `${SEARCH}?${new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "6",
    addressdetails: "0",
  })}`;

  const res = await fetchWithTimeout(url, { timeoutMs: 12_000 });
  if (!res.ok) {
    throw new UpstreamError(`Place lookup failed (${res.status})`, res.status);
  }

  const places = (await res.json()) as NominatimPlace[];
  const results = places.map(toResult);
  searchCache.set(key, results);
  return results;
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = reverseCache.get(key);
  if (cached) return cached;

  const url = `${REVERSE}?${new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    zoom: "14",
  })}`;

  const res = await fetchWithTimeout(url, { timeoutMs: 12_000 });
  if (!res.ok) {
    throw new UpstreamError(`Reverse lookup failed (${res.status})`, res.status);
  }

  const place = (await res.json()) as { display_name?: string };
  const label = place.display_name ?? key;
  reverseCache.set(key, label);
  return label;
}

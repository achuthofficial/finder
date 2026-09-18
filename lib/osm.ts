import { GROUPS } from "./categories";
import { TtlCache, UpstreamError, fetchWithTimeout } from "./http";
import { scoreLead, toBusiness } from "./normalize";
import type { Business, CategoryGroup } from "./types";

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function endpoints(): string[] {
  const configured = process.env.OVERPASS_ENDPOINTS;
  if (!configured) return DEFAULT_ENDPOINTS;
  const list = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_ENDPOINTS;
}

/** Bare-key filters need a guard: `shop=no` marks a *former* shop. */
const NEGATIVE_VALUES = "^(no|vacant|disused|abandoned|closed)$";

const MAX_ELEMENTS = 800;

/** Statuses that mean "ask a different mirror", not "the query was wrong". */
const RETRYABLE = new Set([403, 429, 504]);

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

const cache = new TtlCache<Business[]>(10 * 60_000);

function selectorsFor(groups: CategoryGroup[]): string[] {
  const defs = groups.length
    ? GROUPS.filter((g) => groups.includes(g.id))
    : GROUPS;

  const selectors = new Set<string>();
  for (const def of defs) {
    for (const filter of def.osm) {
      if (filter.includes("=")) {
        const [key, value] = filter.split("=");
        selectors.add(`["${key}"="${value}"]`);
      } else {
        selectors.add(`["${filter}"]["${filter}"!~"${NEGATIVE_VALUES}"]`);
      }
    }
  }

  // A bare-key selector already covers every `key=value` selector on the same
  // key, so drop the redundant ones — Overpass charges for each statement.
  const bareKeys = new Set(
    [...selectors]
      .map((s) => /^\["([a-z:_]+)"\]\["/.exec(s)?.[1])
      .filter((k): k is string => Boolean(k)),
  );
  return [...selectors].filter((s) => {
    const exact = /^\["([a-z:_]+)"="/.exec(s)?.[1];
    return !exact || !bareKeys.has(exact);
  });
}

export function buildQuery(
  lat: number,
  lon: number,
  radius: number,
  groups: CategoryGroup[],
): string {
  const around = `(around:${Math.round(radius)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const body = selectorsFor(groups)
    .map((sel) => `  nwr${sel}["name"]${around};`)
    .join("\n");

  return `[out:json][timeout:45];\n(\n${body}\n);\nout tags center ${MAX_ELEMENTS};`;
}

async function runQuery(query: string): Promise<OverpassResponse> {
  let lastError: Error | null = null;

  for (const endpoint of endpoints()) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        timeoutMs: 50_000,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
      });

      // A mirror that is busy (429/504), blocking us (403) or broken (5xx) is
      // worth retrying elsewhere; anything else is our own bad request.
      if (RETRYABLE.has(res.status) || res.status >= 500) {
        lastError = new UpstreamError(
          `mirror ${new URL(endpoint).host} answered ${res.status}`,
          res.status,
        );
        continue;
      }
      if (!res.ok) {
        throw new UpstreamError(
          `The map data provider rejected the query (${res.status}).`,
          res.status,
        );
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      if (err instanceof UpstreamError && !RETRYABLE.has(err.status) && err.status < 500) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Keep the per-mirror detail in the logs; the user gets the plain version.
  console.warn("[overpass] all mirrors failed:", lastError?.message);
  throw new UpstreamError(
    "Every OpenStreetMap mirror we tried is unavailable right now. Give it a minute, or try a smaller radius.",
    503,
  );
}

export interface OsmSearchResult {
  businesses: Business[];
  truncated: boolean;
  notice?: string;
}

export async function searchOsm(
  lat: number,
  lon: number,
  radius: number,
  groups: CategoryGroup[],
): Promise<OsmSearchResult> {
  const key = [
    lat.toFixed(3),
    lon.toFixed(3),
    Math.round(radius / 100),
    [...groups].sort().join("|"),
  ].join(":");

  const cached = cache.get(key);
  if (cached) {
    return { businesses: cached, truncated: cached.length >= MAX_ELEMENTS };
  }

  const data = await runQuery(buildQuery(lat, lon, radius, groups));
  const elements = data.elements ?? [];

  const seen = new Set<string>();
  const businesses: Business[] = [];

  for (const el of elements) {
    const position = el.center ?? { lat: el.lat, lon: el.lon };
    if (typeof position.lat !== "number" || typeof position.lon !== "number") {
      continue;
    }
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;

    // The same business is often mapped as both a node and a building outline.
    const dedupeKey = `${name.toLowerCase()}@${position.lat.toFixed(4)},${position.lon.toFixed(4)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const business = toBusiness(el.type, el.id, position.lat, position.lon, tags);
    if (business) businesses.push(business);
  }

  businesses.sort((a, b) => b.leadScore - a.leadScore || a.name.localeCompare(b.name));
  cache.set(key, businesses);

  return {
    businesses,
    truncated: elements.length >= MAX_ELEMENTS,
    notice: data.remark,
  };
}

export { scoreLead };

/** Fetch the tags of a single element, for the detail view. */
export async function fetchElementTags(
  type: "node" | "way" | "relation",
  id: number,
): Promise<Record<string, string>> {
  const data = await runQuery(`[out:json][timeout:20];${type}(${id});out tags;`);
  return data.elements?.[0]?.tags ?? {};
}

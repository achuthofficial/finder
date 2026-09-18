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

/**
 * Collapse the requested groups into one selector per tag key.
 *
 * This matters a great deal. Written the obvious way — one `nwr` statement per
 * `key=value` pair — a full search is 44 statements, and Overpass runs a
 * separate spatial scan for each one. Over a dense city at a 10 km radius that
 * reliably times out. Grouping the values of a key into a single regex turns
 * those 44 scans into about 7.
 */
export function selectorsFor(groups: CategoryGroup[]): string[] {
  const defs = groups.length ? GROUPS.filter((g) => groups.includes(g.id)) : GROUPS;

  const bareKeys = new Set<string>();
  const valuesByKey = new Map<string, Set<string>>();

  for (const def of defs) {
    for (const filter of def.osm) {
      if (filter.includes("=")) {
        const [key, value] = filter.split("=");
        const values = valuesByKey.get(key) ?? new Set<string>();
        values.add(value);
        valuesByKey.set(key, values);
      } else {
        bareKeys.add(filter);
      }
    }
  }

  const selectors: string[] = [];

  for (const key of bareKeys) {
    // `shop=no` marks a *former* shop, so bare keys need the negative guard.
    selectors.push(`["${key}"]["${key}"!~"${NEGATIVE_VALUES}"]`);
  }

  for (const [key, values] of valuesByKey) {
    // A bare-key selector already covers every value of that key.
    if (bareKeys.has(key)) continue;
    const sorted = [...values].sort();
    selectors.push(
      sorted.length === 1
        ? `["${key}"="${sorted[0]}"]`
        : `["${key}"~"^(${sorted.join("|")})$"]`,
    );
  }

  return selectors.sort();
}

/**
 * Overpass needs a self-declared timeout, and it must be lower than ours or the
 * server keeps grinding after we have already given up on it.
 */
export function overpassTimeout(budgetMs: number): number {
  return Math.max(10, Math.min(50, Math.floor(budgetMs / 1000) - 2));
}

export function buildQuery(
  lat: number,
  lon: number,
  radius: number,
  groups: CategoryGroup[],
  budgetMs = 25_000,
): string {
  const around = `(around:${Math.round(radius)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const body = selectorsFor(groups)
    .map((sel) => `  nwr${sel}["name"]${around};`)
    .join("\n");

  return `[out:json][timeout:${overpassTimeout(budgetMs)}];\n(\n${body}\n);\nout tags center ${MAX_ELEMENTS};`;
}

/**
 * How long the whole search may take, across every mirror we try. It has to sit
 * comfortably inside the serverless function's own limit: overrun it and the
 * platform kills the request and returns its own 504, so the user gets an
 * unexplained gateway error instead of our message.
 */
const TOTAL_BUDGET_MS = 45_000;

/** Kept back so a mirror that times out cannot consume the whole budget. */
const RESERVE_PER_ATTEMPT_MS = 8_000;

async function runQuery(
  build: (budgetMs: number) => string,
): Promise<OverpassResponse> {
  let lastError: Error | null = null;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const list = endpoints();

  for (const [index, endpoint] of list.entries()) {
    const remaining = deadline - Date.now();
    const attemptsLeft = list.length - index - 1;
    // Let this attempt use most of what is left, but keep a reserve so a
    // mirror that hangs still leaves room to ask another one.
    const budget = remaining - RESERVE_PER_ATTEMPT_MS * attemptsLeft;
    if (budget < 4_000) break;

    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        timeoutMs: budget,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: build(budget) }).toString(),
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

  // A timeout and an outage need different advice, so tell them apart.
  const timedOut =
    lastError?.name === "AbortError" || /timeout|abort/i.test(lastError?.message ?? "");
  throw new UpstreamError(
    timedOut
      ? "This area is too large or too busy for the free map data service to answer in time. Zoom in, or drag the radius down, and try again."
      : "Every OpenStreetMap mirror we tried is unavailable right now. Give it a minute and try again.",
    timedOut ? 504 : 503,
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

  const data = await runQuery((budgetMs) =>
    buildQuery(lat, lon, radius, groups, budgetMs),
  );
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
  const data = await runQuery(() => `[out:json][timeout:20];${type}(${id});out tags;`);
  return data.elements?.[0]?.tags ?? {};
}

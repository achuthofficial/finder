export type WebPresence = "site" | "social-only" | "none";

export interface Business {
  /** Stable id, namespaced by source (e.g. "osm:node/123", "google:ChIJ..."). */
  id: string;
  source: "osm" | "google";
  name: string;
  /** Human-readable category, e.g. "Bakery". */
  category: string;
  /** Machine category group used by the filter chips. */
  group: CategoryGroup;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  website?: string;
  /** Social profiles found when there is no real website. */
  socials: { label: string; url: string }[];
  presence: WebPresence;
  openingHours?: string;
  rating?: number;
  reviewCount?: number;
  /** 0-100. Higher = better cold-outreach lead. */
  leadScore: number;
  /** Deep link to the source record, for verification. */
  sourceUrl: string;
}

export interface SearchStats {
  total: number;
  noWebsite: number;
  socialOnly: number;
  withWebsite: number;
  /** Share of businesses with no website of their own, 0-1. */
  opportunityRate: number;
}

export interface SearchResponse {
  businesses: Business[];
  stats: SearchStats;
  center: { lat: number; lon: number };
  radius: number;
  source: "osm" | "google";
  /** True when the provider capped the result set. */
  truncated: boolean;
  /** Milliseconds spent upstream; handy for the footer. */
  elapsedMs: number;
  notice?: string;
}

export type CategoryGroup =
  | "food"
  | "retail"
  | "services"
  | "health"
  | "beauty"
  | "trades"
  | "professional"
  | "lodging"
  | "leisure"
  | "auto"
  | "other";

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  /** Suggested search radius in metres, derived from the feature's extent. */
  suggestedRadius: number;
  type?: string;
}

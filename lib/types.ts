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
  /** True when the source can supply photos/reviews via /api/place. */
  hasDetails: boolean;
}

export interface Photo {
  url: string;
  /** Same image proxied through our origin, so it is CORS-safe and downloadable. */
  proxyUrl: string;
  width?: number;
  height?: number;
  attribution?: string;
  licence?: string;
}

export interface Review {
  author: string;
  rating: number;
  text: string;
  relativeTime?: string;
  profileUrl?: string;
}

export interface PlaceDetails {
  id: string;
  photos: Photo[];
  reviews: Review[];
  rating?: number;
  reviewCount?: number;
  /** Why a section is empty, when it is — shown verbatim in the UI. */
  notes: { photos?: string; reviews?: string };
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

export type TargetStatus = "new" | "contacted" | "replied" | "quoted" | "won" | "lost";

export interface Target {
  business: Business;
  status: TargetStatus;
  notes: string;
  /** ms epoch, for "added" ordering. */
  addedAt: number;
}

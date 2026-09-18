import { NextResponse } from "next/server";
import { parseGroups } from "@/lib/categories";
import { googleEnabled, searchGoogle } from "@/lib/google";
import { UpstreamError } from "@/lib/http";
import { searchOsm } from "@/lib/osm";
import { allow, clientKey } from "@/lib/ratelimit";
import type { Business, SearchResponse, SearchStats } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_RADIUS = 200;
const MAX_RADIUS = 15_000;

function statsFor(businesses: Business[]): SearchStats {
  const noWebsite = businesses.filter((b) => b.presence === "none").length;
  const socialOnly = businesses.filter((b) => b.presence === "social-only").length;
  const withWebsite = businesses.length - noWebsite - socialOnly;
  return {
    total: businesses.length,
    noWebsite,
    socialOnly,
    withWebsite,
    opportunityRate: businesses.length
      ? (noWebsite + socialOnly) / businesses.length
      : 0,
  };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return bad("`lat` must be a number between -90 and 90.");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return bad("`lon` must be a number between -180 and 180.");
  }

  const requested = Number(params.get("radius"));
  const radius = Number.isFinite(requested)
    ? Math.min(Math.max(requested, MIN_RADIUS), MAX_RADIUS)
    : 1500;

  const groups = parseGroups(params.get("groups"));
  const source = params.get("source") === "google" ? "google" : "osm";

  if (source === "google" && !googleEnabled()) {
    return bad(
      "Google Places is not configured on this deployment. Switch the source to OpenStreetMap, which needs no key.",
      501,
    );
  }

  if (!allow(clientKey(request))) {
    return bad("Too many searches in a row — give it a few seconds.", 429);
  }

  const started = Date.now();

  try {
    const result =
      source === "google"
        ? await searchGoogle(lat, lon, radius, groups)
        : await searchOsm(lat, lon, radius, groups);

    const payload: SearchResponse = {
      businesses: result.businesses,
      stats: statsFor(result.businesses),
      center: { lat, lon },
      radius,
      source,
      truncated: result.truncated,
      elapsedMs: Date.now() - started,
      notice: result.notice,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    if (error instanceof UpstreamError) {
      return bad(error.message, error.status >= 400 && error.status < 600 ? error.status : 502);
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The map data provider took too long. Try a smaller radius or fewer categories."
        : "Something went wrong talking to the map data provider.";
    return bad(message, 504);
  }
}

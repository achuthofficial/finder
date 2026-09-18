import { UpstreamError, fetchWithTimeout } from "./http";
import { fetchElementTags } from "./osm";
import { isProxyableUrl } from "./photoProxy";
import type { PlaceDetails, Photo, Review } from "./types";
import { photosForTags } from "./wikimedia";

const NO_OSM_REVIEWS =
  "OpenStreetMap does not hold ratings or reviews — nobody writes them there. Add a Google Places key to this deployment to see them.";

const NO_OSM_PHOTOS =
  "No photo is linked from this record. OpenStreetMap only carries photos for businesses someone has linked to Wikimedia, which is rare for small shops.";

function parseOsmId(id: string): { type: "node" | "way" | "relation"; ref: number } | null {
  const match = /^osm:(node|way|relation)\/(\d+)$/.exec(id);
  if (!match) return null;
  return { type: match[1] as "node" | "way" | "relation", ref: Number(match[2]) };
}

async function osmDetails(id: string): Promise<PlaceDetails> {
  const parsed = parseOsmId(id);
  if (!parsed) throw new UpstreamError("Not a valid OpenStreetMap id.", 400);

  const tags = await fetchElementTags(parsed.type, parsed.ref);
  const all = await photosForTags(tags);

  // Anything we cannot proxy cannot be shown inline or embedded in a PDF.
  const photos = all.filter((photo) => isProxyableUrl(photo.url));

  return {
    id,
    photos,
    reviews: [],
    notes: {
      photos: photos.length ? undefined : NO_OSM_PHOTOS,
      reviews: NO_OSM_REVIEWS,
    },
  };
}

interface GooglePhoto {
  name: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: { displayName?: string; uri?: string }[];
}

interface GoogleReview {
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  relativePublishTimeDescription?: string;
  authorAttribution?: { displayName?: string; uri?: string };
}

const DETAIL_FIELDS = [
  "id",
  "rating",
  "userRatingCount",
  "photos",
  "reviews",
  "googleMapsUri",
].join(",");

async function googleDetails(id: string): Promise<PlaceDetails> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new UpstreamError(
      "Google Places is not configured on this deployment, so photos and reviews are unavailable.",
      501,
    );
  }

  const placeId = id.slice("google:".length);
  const res = await fetchWithTimeout(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      timeoutMs: 15_000,
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAIL_FIELDS },
    },
  );

  if (!res.ok) {
    throw new UpstreamError(`Google Places details failed (${res.status}).`, res.status);
  }

  const data = (await res.json()) as {
    rating?: number;
    userRatingCount?: number;
    photos?: GooglePhoto[];
    reviews?: GoogleReview[];
  };

  const photos: Photo[] = (data.photos ?? []).slice(0, 10).map((photo) => ({
    // The media URL needs the API key, so it is only ever built server-side
    // inside the proxy — the browser sees the proxy path and nothing else.
    url: `/api/photo?g=${encodeURIComponent(photo.name)}`,
    proxyUrl: `/api/photo?g=${encodeURIComponent(photo.name)}`,
    width: photo.widthPx,
    height: photo.heightPx,
    attribution: photo.authorAttributions?.[0]?.displayName ?? "Google Maps contributor",
    licence: "Google Maps",
  }));

  const reviews: Review[] = (data.reviews ?? [])
    .map((review) => ({
      author: review.authorAttribution?.displayName ?? "Google user",
      rating: review.rating ?? 0,
      text: (review.text?.text ?? review.originalText?.text ?? "").trim(),
      relativeTime: review.relativePublishTimeDescription,
      profileUrl: review.authorAttribution?.uri,
    }))
    .filter((review) => review.text.length > 0)
    // Best-rated first: a freelancer wants the pitch-worthy quotes at the top.
    .sort((a, b) => b.rating - a.rating);

  return {
    id,
    photos,
    reviews,
    rating: data.rating,
    reviewCount: data.userRatingCount,
    notes: {
      photos: photos.length ? undefined : "Google has no photos for this place.",
      reviews: reviews.length
        ? undefined
        : "Google returns no written reviews for this place.",
    },
  };
}

export function placeDetails(id: string): Promise<PlaceDetails> {
  if (id.startsWith("google:")) return googleDetails(id);
  if (id.startsWith("osm:")) return osmDetails(id);
  return Promise.reject(new UpstreamError("Unknown place id.", 400));
}
